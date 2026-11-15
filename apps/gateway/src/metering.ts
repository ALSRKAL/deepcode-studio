import { eq, inArray, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { TokenUsage, UpstreamApiType } from "@deepcode/shared";
import { subscriptions, usageDaily, usageLogs, type Database } from "@deepcode/db";
import type { Logger } from "./logger.js";

export interface SettlementRecord {
  requestId: string;
  createdAt: string; // ISO; part of the usage_logs primary key, so replays hit the same row
  userId: string;
  keyId: string;
  keyHash: string;
  subscriptionId: string;
  poolKeyId: string | null;
  providerId: string | null;
  model: string;
  apiType: UpstreamApiType;
  usage: TokenUsage;
  credits: number;
  estimated: boolean;
  status: "ok" | "client_abort" | "upstream_error" | "rejected";
  httpStatus: number;
  ttfbMs: number | null;
  durationMs: number;
  retries: number;
}

export interface Balance {
  creditsLimit: number;
  creditsUsed: number;
}

const STREAM = "settle:pending";
const DEAD_LETTER = "settle:dead";

/**
 * SQLSTATE classes that mean "this record can never succeed": data exceptions (22),
 * integrity violations (23), syntax/undefined objects (42). Anything else (connection
 * loss, shutdown, serialization) is transient and must be retried, not discarded.
 */
function isPoison(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = typeof e?.code === "string" ? e.code : typeof e?.cause?.code === "string" ? e.cause.code : "";
  return /^(22|23|42)/.test(code);
}

/**
 * Settles many records in ONE transaction (doc 02 §6.5, revised after load testing):
 *   1. multi-row insert of usage rows; ON CONFLICT DO NOTHING makes replays no-ops
 *   2. only rows that were new count: daily rollups are pre-aggregated and upserted
 *   3. one atomic UPDATE ... RETURNING per subscription, in id order (no deadlocks)
 * Per-request transactions serialised on the subscriber's row and starved the
 * connection pool at 150 concurrent streams; batching makes that one update per
 * subscription per batch.
 */
export async function settleBatch(db: Database, recs: SettlementRecord[]): Promise<Map<string, Balance>> {
  if (recs.length === 0) return new Map();
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(usageLogs)
      .values(
        recs.map((r) => ({
          requestId: r.requestId,
          userId: r.userId,
          keyId: r.keyId,
          subscriptionId: r.subscriptionId,
          poolKeyId: r.poolKeyId,
          providerId: r.providerId,
          model: r.model,
          apiType: r.apiType,
          inputTokens: r.usage.input,
          cachedInputTokens: r.usage.cachedInput,
          outputTokens: r.usage.output,
          reasoningTokens: r.usage.reasoning,
          creditsCharged: r.credits,
          estimated: r.estimated,
          status: r.status,
          httpStatus: r.httpStatus,
          ttfbMs: r.ttfbMs,
          durationMs: r.durationMs,
          retries: r.retries,
          createdAt: new Date(r.createdAt),
        })),
      )
      .onConflictDoNothing()
      .returning({ requestId: usageLogs.requestId });
    const fresh = new Set(inserted.map((r) => r.requestId));
    const freshRecs = recs.filter((r) => fresh.has(r.requestId));

    const daily = new Map<string, typeof usageDaily.$inferInsert>();
    const delta = new Map<string, number>();
    for (const r of freshRecs) {
      const day = r.createdAt.slice(0, 10);
      const k = `${r.userId}|${day}|${r.model}`;
      const d = daily.get(k) ?? { userId: r.userId, day, model: r.model, requests: 0, inputTokens: 0, outputTokens: 0, creditsCharged: 0 };
      d.requests! += 1;
      d.inputTokens! += r.usage.input;
      d.outputTokens! += r.usage.output;
      d.creditsCharged! += r.credits;
      daily.set(k, d);
      delta.set(r.subscriptionId, (delta.get(r.subscriptionId) ?? 0) + r.credits);
    }

    if (daily.size > 0) {
      await tx
        .insert(usageDaily)
        .values([...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v))
        .onConflictDoUpdate({
          target: [usageDaily.userId, usageDaily.day, usageDaily.model],
          set: {
            requests: sql`${usageDaily.requests} + excluded.requests`,
            inputTokens: sql`${usageDaily.inputTokens} + excluded.input_tokens`,
            outputTokens: sql`${usageDaily.outputTokens} + excluded.output_tokens`,
            creditsCharged: sql`${usageDaily.creditsCharged} + excluded.credits_charged`,
          },
        });
    }

    // The subscription row is the hottest lock; take it last, in a fixed order.
    const balances = new Map<string, Balance>();
    for (const [subscriptionId, credits] of [...delta.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [b] = await tx
        .update(subscriptions)
        .set({ creditsUsed: sql`${subscriptions.creditsUsed} + ${credits}`, updatedAt: sql`now()` })
        .where(eq(subscriptions.id, subscriptionId))
        .returning({ creditsLimit: subscriptions.creditsLimit, creditsUsed: subscriptions.creditsUsed });
      if (b) balances.set(subscriptionId, b);
    }

    const missing = [...new Set(recs.map((r) => r.subscriptionId))].filter((id) => !balances.has(id));
    if (missing.length > 0) {
      const rows = await tx
        .select({ id: subscriptions.id, creditsLimit: subscriptions.creditsLimit, creditsUsed: subscriptions.creditsUsed })
        .from(subscriptions)
        .where(inArray(subscriptions.id, missing));
      for (const r of rows) balances.set(r.id, { creditsLimit: r.creditsLimit, creditsUsed: r.creditsUsed });
    }
    return balances;
  });
}

interface Pending {
  rec: SettlementRecord;
  entryId: string | null;
  resolve: (b: Balance | null) => void;
}

/**
 * Write-ahead + batching:
 *  - submit() appends the record to a Redis stream first, so a crash after the
 *    response cannot lose the charge; another instance's drainer will settle it.
 *  - records are committed in batches every `flushIntervalMs` (or at `maxBatch`).
 *  - after commit, stream entries are deleted. settleBatch is idempotent, so a
 *    record settled twice (live flush + drainer) is charged once.
 */
export class Settlement {
  #buffer: Pending[] = [];
  #timer: NodeJS.Timeout | undefined;
  #chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: {
      db: Database;
      redis: Redis;
      logger: Logger;
      now: () => number;
      flushIntervalMs?: number;
      maxBatch?: number;
    },
  ) {}

  async submit(rec: SettlementRecord): Promise<Balance | null> {
    let entryId: string | null = null;
    try {
      entryId = await this.deps.redis.xadd(STREAM, "*", "rec", JSON.stringify(rec));
    } catch (err) {
      this.deps.logger.error("settlement write-ahead failed; relying on in-memory batch", {
        requestId: rec.requestId,
        err,
        alert: true,
      });
    }
    return new Promise<Balance | null>((resolve) => {
      this.#buffer.push({ rec, entryId, resolve });
      if (this.#buffer.length >= (this.deps.maxBatch ?? 200)) this.flush();
      else this.#schedule();
    });
  }

  #schedule(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.flush();
    }, this.deps.flushIntervalMs ?? 100);
  }

  /** Flushes are serialised per instance; each flush commits one batch. */
  flush(): Promise<void> {
    this.#chain = this.#chain.then(() => this.#flushOnce());
    return this.#chain;
  }

  async #flushOnce(): Promise<void> {
    const batch = this.#buffer.splice(0, this.deps.maxBatch ?? 200);
    if (batch.length === 0) return;
    try {
      const { balances, settled } = await this.#settleIsolating(batch);
      for (const b of batch) b.resolve(settled.has(b.rec.requestId) ? (balances.get(b.rec.subscriptionId) ?? null) : null);
    } catch (err) {
      // Transient failure (database unreachable): entries stay in the stream for the drainer.
      this.deps.logger.error("settlement batch failed; left for the drainer", { size: batch.length, err });
      for (const b of batch) b.resolve(null);
    }
    if (this.#buffer.length > 0) this.#schedule();
  }

  /**
   * Settles a batch. If the batch fails, settles records one by one so a single
   * poison record cannot block everyone else's billing: poison records go to the
   * dead-letter stream with an alert; a transient error is rethrown (retry later).
   * Stream entries are deleted only for records that were settled or dead-lettered.
   */
  async #settleIsolating(
    items: Array<{ rec: SettlementRecord; entryId: string | null }>,
  ): Promise<{ balances: Map<string, Balance>; settled: Set<string> }> {
    const ack = async (ids: Array<string | null>) => {
      const real = ids.filter((id): id is string => id !== null);
      if (real.length > 0) await this.deps.redis.xdel(STREAM, ...real).catch(() => 0);
    };
    try {
      const balances = await settleBatch(this.deps.db, items.map((i) => i.rec));
      await ack(items.map((i) => i.entryId));
      return { balances, settled: new Set(items.map((i) => i.rec.requestId)) };
    } catch (err) {
      if (!isPoison(err)) throw err;
    }
    const balances = new Map<string, Balance>();
    const settled = new Set<string>();
    for (const item of items) {
      try {
        for (const [k, v] of await settleBatch(this.deps.db, [item.rec])) balances.set(k, v);
        settled.add(item.rec.requestId);
        await ack([item.entryId]);
      } catch (err) {
        if (!isPoison(err)) throw err;
        await this.deps.redis.xadd(DEAD_LETTER, "*", "rec", JSON.stringify(item.rec), "error", String((err as Error).message).slice(0, 300));
        await ack([item.entryId]);
        this.deps.logger.error("settlement record rejected by the database; moved to dead letter", {
          requestId: item.rec.requestId,
          alert: true,
        });
      }
    }
    return { balances, settled };
  }

  /** Retries entries older than `minAgeMs` (left by a failed flush or a crashed instance). */
  async drain(minAgeMs = 30_000, batch = 500): Promise<number> {
    const end = String(Math.max(0, this.deps.now() - minAgeMs));
    const entries = (await this.deps.redis.xrange(STREAM, "-", end, "COUNT", batch)) as Array<[string, string[]]>;
    if (entries.length === 0) return 0;
    const items: Array<{ rec: SettlementRecord; entryId: string | null }> = [];
    for (const [id, fields] of entries) {
      const json = fields[fields.indexOf("rec") + 1];
      if (json) items.push({ rec: JSON.parse(json) as SettlementRecord, entryId: id });
      else await this.deps.redis.xdel(STREAM, id);
    }
    try {
      return (await this.#settleIsolating(items)).settled.size;
    } catch (err) {
      this.deps.logger.error("settlement drain failed; will retry", { size: items.length, err });
      return 0;
    }
  }

  async deadLetterDepth(): Promise<number> {
    return this.deps.redis.xlen(DEAD_LETTER);
  }

  async depth(): Promise<number> {
    return this.deps.redis.xlen(STREAM);
  }

  /** Flush everything still buffered (graceful shutdown). */
  async close(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    while (this.#buffer.length > 0) await this.flush();
    await this.#chain;
  }
}
