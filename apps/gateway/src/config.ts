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
  UPSTREAM_STREAM_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  UPSTREAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  UPSTREAM_BODY_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
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
  trustProxy: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Max upstream attempts per request (doc 02 §5.2). */
  maxAttempts: number;
  /** Settlement wait before the terminal stream event is released (doc 02 §6.5). */
  settleWaitMs: number;
  poolReloadIntervalMs: number;
  catalogReloadIntervalMs: number;
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
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    maxAttempts: 3,
    settleWaitMs: 1_500,
    snapshotTtlSec: 30,
    poolReloadIntervalMs: e.POOL_RELOAD_INTERVAL_MS,
    catalogReloadIntervalMs: e.CATALOG_RELOAD_INTERVAL_MS,
  };
}
