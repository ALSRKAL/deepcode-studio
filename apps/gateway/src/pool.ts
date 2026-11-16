import { createDecipheriv } from "node:crypto";
import { inspect } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { upstreamPoolKeys, upstreamProviders, type Database } from "@deepcode/db";
import type { Logger, SecretRegistry } from "./logger.js";
import type { RedisScripts } from "./redisScripts.js";
import type { Redis } from "ioredis";

/**
 * Decryption lives here and only here (doc 04 §3.1). The plaintext is held in a
 * private field and never appears in JSON, util.inspect or string conversion.
 */
export function decryptPoolKey(ciphertext: Buffer, nonce: Buffer, encryptionKey: Buffer): string {
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export class PoolKey {
  readonly #secret: string;

  constructor(
    readonly id: string,
    readonly providerId: string,
    readonly fingerprint: string,
    readonly weight: number,
    readonly maxConcurrency: number,
    readonly supportedModels: string[] | null,
    secret: string,
  ) {
    this.#secret = secret;
  }

  /** The only accessor. Call it at the point of building the upstream request, nowhere else. */
  reveal(): string {
    return this.#secret;
  }

  supports(model: string): boolean {
    return this.supportedModels === null || this.supportedModels.includes(model);
  }

  toJSON() {
    return { id: this.id, providerId: this.providerId, fingerprint: this.fingerprint };
  }

  toString() {
    return `PoolKey(${this.id}, ${this.fingerprint})`;
  }

  [inspect.custom]() {
    return this.toString();
  }
}

const STALE_INFLIGHT_MS = 30 * 60_000;
const MINUTE_STAT_TTL_SEC = 48 * 3600;
const TOTALS_TTL_SEC = 24 * 3600;

export type SelectResult = { key: PoolKey; release: () => Promise<void> } | { key: null; retryAfterMs: number };

export class PoolManager {
  #keys = new Map<string, PoolKey>();

  constructor(
    private readonly deps: {
      db: Database;
      redis: Redis;
      scripts: RedisScripts;
      encryptionKey: Buffer;
      secrets: SecretRegistry;
      logger: Logger;
      now: () => number;
    },
  ) {}

  async reload(): Promise<void> {
    const rows = await this.deps.db
      .select({ key: upstreamPoolKeys })
      .from(upstreamPoolKeys)
      .innerJoin(upstreamProviders, eq(upstreamPoolKeys.providerId, upstreamProviders.id))
      .where(and(eq(upstreamPoolKeys.status, "active"), eq(upstreamProviders.enabled, true)));
    const next = new Map<string, PoolKey>();
    for (const { key: r } of rows) {
      try {
        const secret = decryptPoolKey(r.keyCiphertext, r.keyNonce, this.deps.encryptionKey);
        this.deps.secrets.add(secret);
        next.set(
          r.id,
          new PoolKey(r.id, r.providerId, r.keyFingerprint, r.weight, r.maxConcurrency, r.supportedModels, secret),
        );
      } catch {
        // Wrong encryption key or corrupted row. Never log the ciphertext.
        this.deps.logger.error("pool key decrypt failed", { poolKeyId: r.id, alert: true });
      }
    }
    for (const old of this.#keys.values()) {
      if (!next.has(old.id)) this.deps.secrets.delete(old.reveal());
    }
    this.#keys = next;
  }

  size(): number {
    return this.#keys.size;
  }

  /** A loaded key by id (quota polling); undefined when inactive or not loaded. */
  get(id: string): PoolKey | undefined {
    return this.#keys.get(id);
  }

  /** Least-loaded selection among the provider's keys that serve `model`. */
  async select(providerId: string, model: string, requestId: string, exclude: Set<string>): Promise<SelectResult> {
    const candidates = [...this.#keys.values()].filter(
      (k) => k.providerId === providerId && k.supports(model) && !exclude.has(k.id),
    );
    if (candidates.length === 0) return { key: null, retryAfterMs: -1 };
    const args: Array<string | number> = [this.deps.now(), STALE_INFLIGHT_MS, model, requestId];
    for (const k of candidates) args.push(k.id, k.weight, k.maxConcurrency);
    const [chosen, soonest] = await this.deps.scripts.run<[string, number]>("POOL_SELECT", [], args);
    const key = chosen ? this.#keys.get(chosen) : undefined;
    if (!key) return { key: null, retryAfterMs: Number(soonest) };
    let released = false;
    return {
      key,
      release: async () => {
        if (released) return;
        released = true;
        await this.deps.redis.zrem(`pool:inflight:${key.id}`, requestId);
      },
    };
  }

  // ---- health (doc 02 §5.2) -------------------------------------------------

  async recordSuccess(key: PoolKey, model: string): Promise<void> {
    await this.deps.redis.multi().del(`pool:fail:${key.id}`, `pool:m429:${key.id}:${model}`).exec();
    await this.#stat(key.id, "ok");
  }

  /** 429 cools the key for THIS MODEL only: OpenCode Go limits are per model. */
  async record429(key: PoolKey, model: string, retryAfterMs: number | null): Promise<number> {
    const counter = `pool:m429:${key.id}:${model}`;
    const [[, n]] = (await this.deps.redis.multi().incr(counter).pexpire(counter, 600_000).exec()) as [[null, number]];
    const backoff = Math.min(30_000 * 2 ** (n - 1), 600_000);
    const cooldown = retryAfterMs !== null && retryAfterMs > 0 ? Math.min(retryAfterMs, 3_600_000) : backoff;
    await this.deps.redis.set(`pool:mcool:${key.id}:${model}`, "1", "PX", cooldown);
    await this.#stat(key.id, "429");
    this.deps.logger.warn("pool key rate limited", { poolKeyId: key.id, model, cooldownMs: cooldown });
    return cooldown;
  }

  /** 5xx / network error cools the whole key with exponential backoff. */
  async recordFailure(key: PoolKey, reason: string): Promise<number> {
    const counter = `pool:fail:${key.id}`;
    const [[, n]] = (await this.deps.redis.multi().incr(counter).pexpire(counter, 600_000).exec()) as [[null, number]];
    const cooldown = Math.min(5_000 * 2 ** (n - 1), 300_000);
    await this.deps.redis.set(`pool:cool:${key.id}`, "1", "PX", cooldown);
    await this.#stat(key.id, "5xx");
    this.deps.logger.warn("pool key failure", { poolKeyId: key.id, reason, cooldownMs: cooldown });
    await this.deps.db
      .update(upstreamPoolKeys)
      .set({ lastErrorAt: new Date(this.deps.now()), lastErrorCode: reason.slice(0, 64) })
      .where(eq(upstreamPoolKeys.id, key.id));
    return cooldown;
  }

  /** 401/403: the account is gone or the key rotated. Remove it and alert an admin. */
  async recordAuthFailure(key: PoolKey, httpStatus: number): Promise<void> {
    this.#keys.delete(key.id);
    this.deps.secrets.delete(key.reveal());
    await this.deps.db
      .update(upstreamPoolKeys)
      .set({
        status: "auth_failed",
        lastErrorAt: new Date(this.deps.now()),
        lastErrorCode: `http_${httpStatus}`,
        updatedAt: new Date(this.deps.now()),
      })
      .where(eq(upstreamPoolKeys.id, key.id));
    this.deps.logger.error("pool key authentication failed; removed from rotation", {
      poolKeyId: key.id,
      fingerprint: key.fingerprint,
      httpStatus,
      alert: true,
    });
  }

  async #stat(keyId: string, field: "ok" | "429" | "5xx"): Promise<void> {
    const d = new Date(this.deps.now());
    const minute = d.toISOString().slice(0, 16).replace(/[-T:]/g, "");
    const mk = `pool:stat:${keyId}:${minute}`;
    await this.deps.redis
      .multi()
      .hincrby(mk, field, 1)
      .expire(mk, MINUTE_STAT_TTL_SEC)
      .hincrby(`pool:tot:${keyId}`, "requests", 1)
      .hincrby(`pool:tot:${keyId}`, field, field === "ok" ? 0 : 1)
      // Sliding TTL: flushStats drains this every 60 s; the TTL only reaps totals of deleted keys.
      .expire(`pool:tot:${keyId}`, TOTALS_TTL_SEC)
      .exec();
  }

  /** Move accumulated totals from Redis into Postgres (every 60 s). */
  async flushStats(): Promise<void> {
    for (const id of this.#keys.keys()) {
      const flat = await this.deps.scripts.run<string[]>("HASH_TAKE", [`pool:tot:${id}`], []);
      if (!flat || flat.length === 0) continue;
      const t: Record<string, number> = {};
      for (let i = 0; i < flat.length; i += 2) t[flat[i]!] = Number(flat[i + 1]);
      await this.deps.db
        .update(upstreamPoolKeys)
        .set({
          totalRequests: sql`${upstreamPoolKeys.totalRequests} + ${t.requests ?? 0}`,
          total429: sql`${upstreamPoolKeys.total429} + ${t["429"] ?? 0}`,
          total5xx: sql`${upstreamPoolKeys.total5xx} + ${t["5xx"] ?? 0}`,
          lastUsedAt: new Date(this.deps.now()),
        })
        .where(eq(upstreamPoolKeys.id, id));
    }
  }
}
