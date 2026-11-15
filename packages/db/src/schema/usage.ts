/**
 * `usage_logs` is range-partitioned by month (docs/plan/02 §3). drizzle-kit cannot
 * express partitioning, so this file is NOT in drizzle.config.ts `schema`; the DDL
 * lives in migrations/0001_usage_logs_partitioned.sql. This definition exists only
 * for typed queries and must be kept in sync with that migration by hand.
 *
 * No prompt or completion content is ever stored here.
 */
import { boolean, integer, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uuid, bigint } from "drizzle-orm/pg-core";

export const usageStatus = pgEnum("usage_status", ["ok", "client_abort", "upstream_error", "rejected"]);

export const usageLogs = pgTable(
  "usage_logs",
  {
    requestId: uuid("request_id").notNull(),
    userId: uuid("user_id").notNull(),
    keyId: uuid("key_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    poolKeyId: uuid("pool_key_id"),
    providerId: text("provider_id"),
    model: text("model").notNull(),
    apiType: text("api_type").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    creditsCharged: bigint("credits_charged", { mode: "number" }).notNull().default(0),
    estimated: boolean("estimated").notNull().default(false),
    status: usageStatus("status").notNull(),
    httpStatus: integer("http_status").notNull(),
    ttfbMs: integer("ttfb_ms"),
    durationMs: integer("duration_ms"),
    retries: smallint("retries").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.createdAt] })],
);
