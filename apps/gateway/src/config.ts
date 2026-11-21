import { z } from "zod";
import { parseEncryptionKey } from "@deepcode/shared/node";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  POOL_KEY_ENCRYPTION_KEY: z.string().min(1),
  KEY_HASH_PEPPER: z.string().min(1),
  GATEWAY_INTERNAL_TOKEN: z.string().min(32),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8790),
  /** Optional second port serving /metrics without auth; bind via GATEWAY_METRICS_HOST (default loopback). */
  GATEWAY_METRICS_PORT: z.coerce.number().int().positive().optional(),
  GATEWAY_METRICS_HOST: z.string().default("127.0.0.1"),
  GATEWAY_PUBLIC_WEB_ORIGIN: z.url().default("http://localhost:3000"),
  // Synthetic sends stream headers only when generation starts; under load that took
  // 90 s (2026-11-18). 30 s turned a slow queue into failures for every stream.
  UPSTREAM_STREAM_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  UPSTREAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  UPSTREAM_BODY_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  // Bounded by the gateway heap (160 MB on the free host): parse + shrink stays well under it.
  MAX_REQUEST_BODY_HARD_BYTES: z.coerce.number().int().positive().default(24 * 1024 * 1024),
  /**
   * Hard cap on estimated input tokens per request (docs/plan/06 §4). The desktop
   * compacts at 228K (256K window); 384K leaves a full summary request room and
   * still stops the 490K requests the old 524K client produced. 0 disables the cap.
   */
  MAX_REQUEST_INPUT_TOKENS: z.coerce.number().int().min(0).default(600_000),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /**
   * Safety-net reload intervals. Changes made in the web admin are pushed at once
   * over the reload channel; these only catch missed messages. On free-tier
   * Postgres that sleeps when idle (e.g. Neon), raise them (e.g. 1800000) so the
   * database is not woken every few seconds (docs/deploy).
   */
  POOL_RELOAD_INTERVAL_MS: z.coerce.number().int().min(5_000).default(15_000),
  CATALOG_RELOAD_INTERVAL_MS: z.coerce.number().int().min(5_000).default(60_000),
  QUOTA_POLL_INTERVAL_MS: z.coerce.number().int().min(60_000).default(900_000),
  QUOTA_ALERT_WEBHOOK_URL: z.string().url().optional(),
  /** Plan tiers allowed to use Synthetic `fast:` (needs a Synthetic plan with Fast mode), e.g. "team". */
  FAST_MODE_TIERS: z.string().default(""),
});

export interface GatewayConfig {
  databaseUrl: string;
  redisUrl: string;
  /** AES-256-GCM key for pool-key ciphertext. Lives only in the gateway process. */
  encryptionKey: Buffer;
  pepper: Buffer;
  internalToken: string;
  port: number;
  /** Unauthenticated metrics listener; disabled when null. */
  metricsPort: number | null;
  metricsHost: string;
  webOrigin: string;
  streamHeadersTimeoutMs: number;
  requestTimeoutMs: number;
  bodyIdleTimeoutMs: number;
  maxRequestBodyBytes: number;
  /** Bodies between the normal limit and this are read and shrunk; above it, compaction is asked for. */
  maxRequestBodyHardBytes: number;
  /** Estimated input-token ceiling per request; 0 turns the check off. */
  maxRequestInputTokens: number;
  trustProxy: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Max upstream attempts per request (doc 02 §5.2). */
  maxAttempts: number;
  /** Settlement wait before the terminal stream event is released (doc 02 §6.5). */
  settleWaitMs: number;
  poolReloadIntervalMs: number;
  catalogReloadIntervalMs: number;
  /** Synthetic /v2/quotas poll interval (free endpoint; default 15 min). */
  quotaPollIntervalMs: number;
  /** Optional webhook (Slack/Discord/any JSON) for low-quota and renewal alerts. */
  quotaAlertWebhookUrl: string | null;
  /** Plan tiers that may use the `fast:` prefix; empty = fast mode off. */
  fastModeTiers: string[];
  /** Auth snapshot TTL. */
  snapshotTtlSec: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Print only the variable names; values may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid gateway environment: ${names}`);
  }
  const e = parsed.data;
  const pepper = Buffer.from(e.KEY_HASH_PEPPER, "base64");
  if (pepper.length < 32) throw new Error("KEY_HASH_PEPPER must decode to at least 32 bytes");
  return {
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    encryptionKey: parseEncryptionKey(e.POOL_KEY_ENCRYPTION_KEY),
    pepper,
    internalToken: e.GATEWAY_INTERNAL_TOKEN,
    port: e.GATEWAY_PORT,
    metricsPort: e.GATEWAY_METRICS_PORT ?? null,
    metricsHost: e.GATEWAY_METRICS_HOST,
    webOrigin: e.GATEWAY_PUBLIC_WEB_ORIGIN.replace(/\/$/, ""),
    streamHeadersTimeoutMs: e.UPSTREAM_STREAM_HEADERS_TIMEOUT_MS,
    requestTimeoutMs: e.UPSTREAM_REQUEST_TIMEOUT_MS,
    bodyIdleTimeoutMs: e.UPSTREAM_BODY_IDLE_TIMEOUT_MS,
    maxRequestBodyBytes: e.MAX_REQUEST_BODY_BYTES,
    maxRequestBodyHardBytes: Math.max(e.MAX_REQUEST_BODY_HARD_BYTES, e.MAX_REQUEST_BODY_BYTES),
    maxRequestInputTokens: e.MAX_REQUEST_INPUT_TOKENS,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    maxAttempts: 3,
    settleWaitMs: 1_500,
    snapshotTtlSec: 30,
    poolReloadIntervalMs: e.POOL_RELOAD_INTERVAL_MS,
    catalogReloadIntervalMs: e.CATALOG_RELOAD_INTERVAL_MS,
    quotaPollIntervalMs: e.QUOTA_POLL_INTERVAL_MS,
    quotaAlertWebhookUrl: e.QUOTA_ALERT_WEBHOOK_URL ?? null,
    fastModeTiers: e.FAST_MODE_TIERS.split(",").map((t) => t.trim()).filter(Boolean),
  };
}
