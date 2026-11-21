import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { sql } from "drizzle-orm";
import { upstreamPoolKeys, type Database } from "@deepcode/db";
import type { Redis } from "ioredis";
import type { GatewayConfig } from "./config.js";
import type { PoolManager } from "./pool.js";
import type { Settlement } from "./metering.js";

export interface MetricsDeps {
  config: GatewayConfig;
  db: Database;
  redis: Redis;
  pool: PoolManager;
  settlement: Settlement;
  streams: { active: number };
  now: () => number;
}

const PREFIX = "deepcode_";

/**
 * Prometheus metrics (docs/plan/02 §9, Phase 1 leftover in docs/plan/04 Step A).
 * Depths and pool state are read from Redis/Postgres at collection time, so a
 * gateway restart resets only the process-local counters and histograms.
 */
export class Metrics {
  readonly registry = new Registry();
  readonly requests: Counter<"route" | "class">;
  readonly duration: Histogram<"route">;
  readonly inputTokens: Histogram<"model">;
  readonly contextRejections: Counter<"model">;
  readonly streamsActive: Gauge;
  readonly settlementPending: Gauge;
  readonly settlementDeadLetter: Gauge;
  readonly #poolStatus: Gauge<"status">;
  readonly #poolKeyTotals: Counter<"pool_key_id" | "outcome">;

  constructor(private readonly deps: MetricsDeps) {
    this.registry.setDefaultLabels({ app: "deepcode-gateway" });
    this.requests = new Counter({
      name: `${PREFIX}requests_total`,
      help: "Model-proxy and status requests by route and response class.",
      labelNames: ["route", "class"],
    });
    this.duration = new Histogram({
      name: `${PREFIX}request_duration_ms`,
      help: "Request duration in milliseconds by route.",
      labelNames: ["route"],
      // p99 target is 50 ms over upstream; buckets cover 1 ms .. 10 s.
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000],
    });
    this.inputTokens = new Histogram({
      name: `${PREFIX}request_input_tokens`,
      help: "Estimated input tokens per model request (docs/plan/06 §7).",
      labelNames: ["model"],
      // The product budget is 256K and the hard cap is 384K; the buckets around
      // those two numbers are what make a regression visible early.
      buckets: [10_000, 25_000, 50_000, 100_000, 150_000, 200_000, 228_000, 262_144, 300_000, 384_000, 500_000, 1_000_000],
    });
    this.contextRejections = new Counter({
      name: `${PREFIX}context_rejections_total`,
      help: "Requests rejected by MAX_REQUEST_INPUT_TOKENS, by model.",
      labelNames: ["model"],
    });
    this.streamsActive = new Gauge({ name: `${PREFIX}streams_active`, help: "Open streaming responses." });
    this.settlementPending = new Gauge({
      name: `${PREFIX}settlement_pending_depth`,
      help: "Records waiting in the settlement write-ahead stream.",
    });
    this.settlementDeadLetter = new Gauge({
      name: `${PREFIX}settlement_dead_letter_depth`,
      help: "Records the database rejected (poison records).",
    });
    this.#poolStatus = new Gauge({
      name: `${PREFIX}pool_keys`,
      help: "Pool keys by status. cooling = a cooldown entry exists in Redis.",
      labelNames: ["status"],
    });
    this.#poolKeyTotals = new Counter({
      name: `${PREFIX}pool_key_requests_total`,
      help: "Per-pool-key request outcome totals read from Redis at scrape time.",
      labelNames: ["pool_key_id", "outcome"],
    });
    this.registry.registerMetric(this.requests);
    this.registry.registerMetric(this.duration);
    this.registry.registerMetric(this.inputTokens);
    this.registry.registerMetric(this.contextRejections);
    this.registry.registerMetric(this.streamsActive);
    this.registry.registerMetric(this.settlementPending);
    this.registry.registerMetric(this.settlementDeadLetter);
    this.registry.registerMetric(this.#poolStatus);
    this.registry.registerMetric(this.#poolKeyTotals);
  }

  /** Maps a request path to a low-cardinality route label. */
  routeLabel(path: string): string {
    if (path.startsWith("/v1/chat/completions")) return "chat_completions";
    if (path.startsWith("/v1/messages")) return "messages";
    if (path.startsWith("/v1/responses")) return "responses";
    if (path.startsWith("/v1beta/models/")) return "google";
    if (path.startsWith("/v1/models")) return "models";
    if (path.startsWith("/v1/subscription/status")) return "subscription_status";
    if (path.startsWith("/v1/sync/manifest")) return "sync_manifest";
    if (path.startsWith("/internal/")) return "internal";
    return "other";
  }

  /** Recorded by the app middleware after every response, including thrown errors. */
  observe(route: string, status: number, durationMs: number): void {
    const cls = status < 300 ? "2xx" : status < 400 ? "3xx" : status === 429 ? "429" : status < 500 ? "4xx" : "5xx";
    this.requests.inc({ route, class: cls });
    this.duration.observe({ route }, durationMs);
  }

  /** Request size distribution (docs/plan/06 §7), recorded before the upstream call. */
  observeInput(model: string, tokens: number): void {
    this.inputTokens.observe({ model }, tokens);
  }

  observeContextRejection(model: string): void {
    this.contextRejections.inc({ model });
  }

  /** Collects scrape-time gauges and counters from Redis and Postgres. */
  async collect(): Promise<void> {
    this.streamsActive.set(this.deps.streams.active);
    const [pending, dead, cooling, dbStatuses] = await Promise.all([
      this.deps.settlement.depth(),
      this.deps.settlement.deadLetterDepth(),
      this.#countCooling(),
      this.deps.db
        .select({ status: upstreamPoolKeys.status, n: sql<number>`count(*)::int` })
        .from(upstreamPoolKeys)
        .groupBy(upstreamPoolKeys.status),
    ]);
    this.settlementPending.set(pending);
    this.settlementDeadLetter.set(dead);

    const byStatus: Record<"active" | "disabled" | "auth_failed" | "cooling", number> = {
      active: 0,
      disabled: 0,
      auth_failed: 0,
      cooling: 0,
    };
    for (const r of dbStatuses) if (r.status in byStatus) byStatus[r.status] = r.n;
    byStatus.active = Math.max(byStatus.active, this.deps.pool.size());
    byStatus.cooling = cooling;
    this.#poolStatus.reset();
    for (const status of Object.keys(byStatus) as Array<keyof typeof byStatus>) {
      this.#poolStatus.set({ status }, byStatus[status]);
    }

    // Per-key outcome totals: the flushed DB counters (every 60 s) plus the Redis
    // delta since the last flush, so the series never appears to reset (the Redis
    // key is consumed by flushStats, the DB columns are cumulative).
    const [flushed, deltas] = await Promise.all([
      this.deps.db
        .select({
          id: upstreamPoolKeys.id,
          totalRequests: upstreamPoolKeys.totalRequests,
          total429: upstreamPoolKeys.total429,
          total5xx: upstreamPoolKeys.total5xx,
        })
        .from(upstreamPoolKeys),
      scanHashes(this.deps.redis, "pool:tot:*"),
    ]);
    this.#poolKeyTotals.reset();
    for (const row of flushed) {
      this.#emitTotal(row.id, "requests", row.totalRequests);
      this.#emitTotal(row.id, "429", row.total429);
      this.#emitTotal(row.id, "5xx", row.total5xx);
    }
    for (const key of deltas) {
      const id = key.name.slice("pool:tot:".length);
      for (const outcome of Object.keys(key.values)) {
        const v = key.values[outcome];
        if (v !== undefined && v > 0) this.#emitTotal(id, outcome, v);
      }
    }
  }

  #emitTotal(id: string, outcome: string, v: number): void {
    this.#poolKeyTotals.inc({ pool_key_id: id, outcome }, v);
  }

  async render(): Promise<string> {
    await this.collect();
    return this.registry.metrics();
  }

  /** Whole-key and per-model cooldowns; a whole-key cooldown subsumes its model ones. */
  async #countCooling(): Promise<number> {
    const [whole, perModel] = await Promise.all([
      scanNames(this.deps.redis, "pool:cool:*"),
      scanNames(this.deps.redis, "pool:mcool:*"),
    ]);
    const wholeIds = new Set(whole.map((n) => n.slice("pool:cool:".length)));
    const modelOnly = perModel.filter((n) => {
      const id = n.slice("pool:mcool:".length);
      return !wholeIds.has(id.split(":")[0]!);
    });
    return wholeIds.size + modelOnly.length;
  }
}

async function scanNames(redis: Redis, pattern: string): Promise<string[]> {
  const names: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    names.push(...batch);
  } while (cursor !== "0");
  return names;
}

async function scanHashes(redis: Redis, pattern: string): Promise<Array<{ name: string; values: Record<string, number> }>> {
  const names = await scanNames(redis, pattern);
  const out: Array<{ name: string; values: Record<string, number> }> = [];
  for (const name of names) {
    const flat = await redis.hgetall(name);
    const values: Record<string, number> = {};
    for (const k of Object.keys(flat)) {
      const raw = flat[k];
      if (raw !== undefined) values[k] = Number(raw);
    }
    out.push({ name, values });
  }
  return out;
}
