/**
 * Core schema (docs/plan/02 §3). Every table here is managed by drizzle-kit.
 * `usage_logs` is partitioned and lives in ./usage.ts with a hand-written migration.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  PLAN_TIERS,
  SUBSCRIPTION_STATUSES,
  UPSTREAM_API_TYPES,
  type UpstreamApiType,
} from "@deepcode/shared";

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const credits = (name: string) => bigint(name, { mode: "number" });

export const planTier = pgEnum("plan_tier", PLAN_TIERS);
export const subscriptionStatus = pgEnum("subscription_status", SUBSCRIPTION_STATUSES);
export const upstreamApiType = pgEnum("upstream_api_type", UPSTREAM_API_TYPES);
export const billingProvider = pgEnum("billing_provider", ["stripe", "lemonsqueezy", "moyasar", "manual", "mock", "upi"]);
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const keyKind = pgEnum("key_kind", ["desktop", "api"]);
export const keyStatus = pgEnum("key_status", ["active", "revoked"]);
export const poolKeyStatus = pgEnum("pool_key_status", ["active", "disabled", "auth_failed"]);
export const billingInterval = pgEnum("billing_interval", ["month", "year"]);
export const releaseChannel = pgEnum("release_channel", ["stable", "preview"]);
export const releasePlatform = pgEnum("release_platform", ["win", "mac", "linux"]);
export const releaseArch = pgEnum("release_arch", ["x64", "arm64"]);
export const marketplaceStatus = pgEnum("marketplace_status", ["draft", "published", "unpublished"]);
export const mcpTransport = pgEnum("mcp_transport", ["stdio", "sse", "http"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /**
     * Boolean, not a timestamp: better-auth (docs/plan/03 §4) owns this column and
     * its user model expects `emailVerified` (docs/plan/02 §10, deviation).
     */
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name"),
    /** Better Auth user model column; unused by our UI today. */
    image: text("image"),
    passwordHash: text("password_hash"),
    locale: text("locale").notNull().default("en"),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    /** Better Auth columns (TOTP two-factor plugin); null until the user enrols. */
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    twoFactorSecret: text("two_factor_secret"),
    backupCodes: text("backup_codes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    check("users_locale_ck", sql`${t.locale} in ('ar', 'en')`),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    tier: planTier("tier").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    interval: billingInterval("interval").notNull().default("month"),
    creditsPerPeriod: credits("credits_per_period").notNull(),
    rpmLimit: integer("rpm_limit").notNull(),
    maxConcurrentStreams: integer("max_concurrent_streams").notNull(),
    /** Explicit list; no wildcard (docs/plan/02 §3). */
    allowedModels: text("allowed_models").array().notNull().default(sql`'{}'::text[]`),
    /** Upper bound applied to max_tokens-style request fields; null = no cap. */
    maxOutputTokens: integer("max_output_tokens"),
    pastDueGraceHours: integer("past_due_grace_hours").notNull().default(72),
    fallbackEnabled: boolean("fallback_enabled").notNull().default(false),
    maxKeys: integer("max_keys").notNull().default(5),
    maxDevices: integer("max_devices").notNull().default(3),
    isPublic: boolean("is_public").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Billing provider price/plan id (e.g. a Stripe price_…); set per provider. */
    providerPriceId: text("provider_price_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("plans_price_ck", sql`${t.priceCents} >= 0`),
    check("plans_credits_ck", sql`${t.creditsPerPeriod} >= 0`),
    check("plans_currency_ck", sql`char_length(${t.currency}) = 3`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus("status").notNull(),
    currentPeriodStart: ts("current_period_start").notNull(),
    expiresAt: ts("expires_at").notNull(),
    /** Copied from the plan at period start; admin adjustments change this, never credits_used. */
    creditsLimit: credits("credits_limit").notNull(),
    /** Single writer: the gateway settlement transaction. */
    creditsUsed: credits("credits_used").notNull().default(0),
    billingProvider: billingProvider("billing_provider").notNull().default("manual"),
    providerSubscriptionId: text("provider_subscription_id"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscriptions_one_live_per_user_uq")
      .on(t.userId)
      .where(sql`${t.status} in ('trialing', 'active', 'past_due')`),
    index("subscriptions_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("subscriptions_credits_used_ck", sql`${t.creditsUsed} >= 0`),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    os: text("os").notNull(),
    appVersion: text("app_version"),
    lastSeenAt: ts("last_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
);

export const virtualApiKeys = pgTable(
  "virtual_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lowercase hex of HMAC-SHA256(KEY_HASH_PEPPER, key). */
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    last4: text("last4").notNull(),
    name: text("name").notNull(),
    kind: keyKind("kind").notNull().default("api"),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    status: keyStatus("status").notNull().default("active"),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    uniqueIndex("virtual_api_keys_hash_uq").on(t.keyHash),
    index("virtual_api_keys_user_idx").on(t.userId),
    check("virtual_api_keys_hash_ck", sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const desktopAuthCodes = pgTable("desktop_auth_codes", {
  codeHash: text("code_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: createdAt(),
});

export const upstreamProviders = pgTable("upstream_providers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /** Base URL per API type, e.g. { "openai-chat-completions": "https://.../openai/v1" }. */
  baseUrls: jsonb("base_urls").$type<Partial<Record<UpstreamApiType, string>>>().notNull(),
  /** Optional header carrying a stable per-subscriber session id (OpenCode asks for x-opencode-session). */
  sessionHeader: text("session_header"),
  enabled: boolean("enabled").notNull().default(true),
  isFallback: boolean("is_fallback").notNull().default(false),
  priority: integer("priority").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const upstreamPoolKeys = pgTable(
  "upstream_pool_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: text("provider_id")
      .notNull()
      .references(() => upstreamProviders.id),
    label: text("label").notNull(),
    keyCiphertext: bytea("key_ciphertext").notNull(),
    keyNonce: bytea("key_nonce").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    keyFingerprint: text("key_fingerprint").notNull(),
    status: poolKeyStatus("status").notNull().default("active"),
    weight: integer("weight").notNull().default(1),
    maxConcurrency: integer("max_concurrency").notNull().default(8),
    /** Null = all models routed to this provider. */
    supportedModels: text("supported_models").array(),
    totalRequests: credits("total_requests").notNull().default(0),
    total429: credits("total_429").notNull().default(0),
    total5xx: credits("total_5xx").notNull().default(0),
    lastErrorAt: ts("last_error_at"),
    lastErrorCode: text("last_error_code"),
    lastUsedAt: ts("last_used_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("upstream_pool_keys_provider_idx").on(t.providerId, t.status),
    check("upstream_pool_keys_weight_ck", sql`${t.weight} > 0`),
    check("upstream_pool_keys_concurrency_ck", sql`${t.maxConcurrency} > 0`),
  ],
);

export const modelRoutes = pgTable(
  "model_routes",
  {
    model: text("model").notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => upstreamProviders.id),
    apiType: upstreamApiType("api_type").notNull(),
    upstreamModel: text("upstream_model").notNull(),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.model, t.providerId] })],
);

export const modelPrices = pgTable(
  "model_prices",
  {
    model: text("model").notNull(),
    inputPerMTok: credits("input_per_mtok").notNull(),
    cachedInputPerMTok: credits("cached_input_per_mtok").notNull(),
    outputPerMTok: credits("output_per_mtok").notNull(),
    effectiveFrom: ts("effective_from").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.model, t.effectiveFrom] })],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    model: text("model").notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: credits("input_tokens").notNull().default(0),
    outputTokens: credits("output_tokens").notNull().default(0),
    creditsCharged: credits("credits_charged").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.model] })],
);

export const creditAdjustments = pgTable("credit_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  deltaCredits: credits("delta_credits").notNull(),
  reason: text("reason").notNull(),
  // Review 2026-11-15: deleting an admin account keeps the adjustment, actor NULL.
  adminId: uuid("admin_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: billingProvider("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_events_provider_event_uq").on(t.provider, t.providerEventId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Review 2026-11-15: account deletion keeps audit history with a NULL actor.
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt.desc())],
);

// ---- Better Auth (docs/plan/03 §4) -------------------------------------------
// The `users` table above is the domain model; these are the session/credential
// stores better-auth requires. Field names follow better-auth's adapter contract.

export const authAccounts = pgTable(
  "auth_accounts",
  {
    /** better-auth's uuid mode omits the id and lets the database generate it. */
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("auth_sessions_token_uq").on(t.token), index("auth_sessions_user_idx").on(t.userId)],
);

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Better Auth two-factor plugin store (TOTP secret + backup codes, never returned). */
export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_two_factor_user_idx").on(t.userId)],
);

// ---- Releases (docs/plan/03 §3.2, §6.5; backs downloads + auto-update) -------

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull(),
    channel: releaseChannel("channel").notNull().default("stable"),
    platform: releasePlatform("platform").notNull(),
    arch: releaseArch("arch").notNull(),
    fileKind: text("file_kind").notNull(), // exe | dmg | zip | AppImage | deb
    url: text("url").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: credits("size_bytes").notNull(),
    notesEn: text("notes_en"),
    notesAr: text("notes_ar"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("releases_target_uq").on(t.version, t.channel, t.platform, t.arch, t.fileKind),
    index("releases_channel_platform_idx").on(t.channel, t.platform, t.arch),
  ],
);

// ---- Marketplace: curated Skills and MCP presets (docs/plan/01 §8.2, 03 §6.4) -

export const marketplaceSkills = pgTable(
  "marketplace_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    descriptionEn: text("description_en").notNull(),
    descriptionAr: text("description_ar").notNull(),
    version: text("version").notNull(),
    minTier: planTier("min_tier").notNull().default("free"),
    /** Server-side storage path; never exposed, only the signed download URL is. */
    archivePath: text("archive_path").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: credits("size_bytes").notNull().default(0),
    /** True when the archive contains executables; publish requires confirmation. */
    hasExecutables: boolean("has_executables").notNull().default(false),
    /** Ed25519 signature over canonicalJson({id, version, sha256}); set at publish. */
    itemSignature: text("item_signature"),
    status: marketplaceStatus("status").notNull().default("draft"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("marketplace_skills_slug_uq").on(t.slug)],
);

export const marketplaceMcpPresets = pgTable(
  "marketplace_mcp_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    descriptionEn: text("description_en").notNull(),
    descriptionAr: text("description_ar").notNull(),
    version: text("version").notNull(),
    minTier: planTier("min_tier").notNull().default("free"),
    transport: mcpTransport("transport").notNull(),
    /** stdio: the command to run. Never executed server-side. */
    command: text("command"),
    args: text("args").array(),
    /** SSE / HTTP: the server URL. */
    url: text("url"),
    /** Required env variable NAMES and descriptions; never values. */
    envSpec: jsonb("env_spec").$type<Array<{ name: string; description: string }>>().notNull().default(sql`'[]'::jsonb`),
    icon: text("icon"),
    /** Ed25519 signature over canonicalJson(config); set at publish. */
    itemSignature: text("item_signature"),
    status: marketplaceStatus("status").notNull().default("draft"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("marketplace_mcp_presets_slug_uq").on(t.slug)],
);

/** Single row: the Skills/MCP sync manifest revision, bumped on publish/unpublish. */
export const syncState = pgTable("sync_state", {
  id: text("id").primaryKey().default("sync"),
  revision: credits("revision").notNull().default(1),
  updatedAt: updatedAt(),
});

/** Server-side checkout sessions (the mock provider; Stripe holds its own). */
/**
 * UPI QR payments with manual approval (owner decision 2026-11-15): the user scans
 * a UPI QR (PhonePe or any UPI app), pays a fixed amount with a reference note,
 * then submits the bank's UTR. An admin confirms the money arrived (in their UPI
 * app) and approves from the smm admin phone app or the web admin panel; approval
 * activates the plan. Amounts are in minor units (paise) of `currency`.
 */
export const upiPaymentStatus = pgEnum("upi_payment_status", [
  "awaiting_payment",
  "submitted",
  "approved",
  "rejected",
  "expired",
]);

export const upiPayments = pgTable(
  "upi_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    /** Short human reference put in the UPI note (tn=) and shown to the admin. */
    reference: text("reference").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: upiPaymentStatus("status").notNull().default("awaiting_payment"),
    /** Bank transaction reference (UTR/RRN) the user reports after paying. */
    utr: text("utr"),
    submittedAt: ts("submitted_at"),
    reviewedAt: ts("reviewed_at"),
    /** Who approved/rejected: "firebase:<uid>" from the phone app or "web:<userId>". */
    reviewedBy: text("reviewed_by"),
    rejectReason: text("reject_reason"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("upi_payments_reference_uq").on(t.reference),
    uniqueIndex("upi_payments_utr_uq").on(t.utr),
    index("upi_payments_status_idx").on(t.status, t.createdAt),
    check("upi_payments_amount_ck", sql`${t.amountMinor} > 0`),
  ],
);

export const billingSessions = pgTable("billing_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  provider: billingProvider("provider").notNull(),
  status: text("status").notNull().default("pending"), // pending | completed | canceled
  locale: text("locale").notNull().default("en"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});
