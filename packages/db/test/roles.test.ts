import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import postgres from "postgres";
import {
  createDatabase,
  modelPrices,
  modelRoutes,
  plans,
  runMigrations,
  subscriptions,
  upstreamPoolKeys,
  upstreamProviders,
  usageDaily,
  users,
  virtualApiKeys,
} from "@deepcode/db";
import { encryptPoolKey, generateVirtualKey, hashVirtualKey, virtualKeyDisplayParts } from "@deepcode/shared/node";
import { applyDatabaseRoles } from "../src/scripts/roles.js";
import { OPENCODE_GO_PROVIDER, usdPerMTokToCredits } from "../src/catalog.js";

/** Runs statements inside one transaction as the given (NOLOGIN) group role. */
function asRole<T>(sql: postgres.Sql, role: string, fn: (tx: postgres.Transaction) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    return fn(tx);
  });
}

const ok = async (p: Promise<unknown>) => {
  await expect(p).resolves.toBeInstanceOf(Array);
};
const denied = async (p: Promise<unknown>) => {
  await expect(p).rejects.toThrow(/permission denied/i);
};

describe("database role grants (docs/plan/04 §3.3)", () => {
  const databaseUrl = inject("databaseUrl");
  const admin = createDatabase(databaseUrl, { max: 2 });
  const probed = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  let fx!: { userId: string; keyId: string; subscriptionId: string };

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    await applyDatabaseRoles(admin);
    // Minimal fixture world: one of everything the grants discriminate on.
    const [user] = await admin.db
      .insert(users)
      .values({ email: "roles-test@test.local", passwordHash: "not-a-real-password", role: "user" })
      .returning();
    const [plan] = await admin.db
      .insert(plans)
      .values({
        id: "plan-roles-test",
        tier: "pro",
        nameEn: "Pro",
        nameAr: "احترافي",
        priceCents: 3000,
        creditsPerPeriod: 1_000_000,
        rpmLimit: 60,
        maxConcurrentStreams: 4,
        allowedModels: ["m-a"],
      })
      .returning();
    const [sub] = await admin.db
      .insert(subscriptions)
      .values({
        userId: user!.id,
        planId: plan!.id,
        status: "active",
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        creditsLimit: 1_000_000,
      })
      .returning();
    const key = generateVirtualKey();
    const [vk] = await admin.db
      .insert(virtualApiKeys)
      .values({
        userId: user!.id,
        keyHash: hashVirtualKey(key, Buffer.alloc(32, 1)).toString("hex"),
        ...virtualKeyDisplayParts(key),
        name: "roles test",
      })
      .returning();
    await admin.db
      .insert(upstreamProviders)
      .values(OPENCODE_GO_PROVIDER)
      .onConflictDoNothing();
    const enc = encryptPoolKey("mock-upstream-key-roles-test", Buffer.alloc(32, 7));
    await admin.db.insert(upstreamPoolKeys).values({
      providerId: OPENCODE_GO_PROVIDER.id,
      label: "k0",
      ...enc,
      keyFingerprint: "fp012345",
    });
    await admin.db
      .insert(modelRoutes)
      .values([
        { model: "m-a", providerId: OPENCODE_GO_PROVIDER.id, apiType: "openai-chat-completions", upstreamModel: "m-a-up" },
        { model: "m-b", providerId: OPENCODE_GO_PROVIDER.id, apiType: "openai-chat-completions", upstreamModel: "m-b-up" },
      ])
      .onConflictDoNothing();
    await admin.db
      .insert(modelPrices)
      .values({ model: "m-a", inputPerMTok: usdPerMTokToCredits(1), cachedInputPerMTok: 0, outputPerMTok: usdPerMTokToCredits(2), effectiveFrom: new Date(0) })
      .onConflictDoNothing();
    await admin.db
      .insert(usageDaily)
      .values({ userId: user!.id, day: new Date().toISOString().slice(0, 10), model: "m-a" })
      .onConflictDoNothing();

    fx = { userId: user!.id, keyId: vk!.id, subscriptionId: sub!.id };
  });

  afterAll(async () => {
    await probed.end({ timeout: 5 });
    await admin.close();
  });

  it("gateway_rw can read, write usage, and update exactly its columns", async () => {
    await ok(asRole(probed, "gateway_rw", (tx) => tx`SELECT id, email FROM users`));
    await ok(asRole(probed, "gateway_rw", (tx) => tx`SELECT id FROM plans`));
    // §3.3: writes by gateway_rw to plans fail.
    await denied(asRole(probed, "gateway_rw", (tx) => tx`UPDATE plans SET sort_order = 99`));
    await denied(asRole(probed, "gateway_rw", (tx) => tx`SELECT password_hash FROM users`));
    await denied(asRole(probed, "gateway_rw", (tx) => tx`SELECT * FROM users`));

    // The settlement write surface works.
    await ok(asRole(probed, "gateway_rw", (tx) =>
      tx`UPDATE subscriptions SET credits_used = credits_used + 1`,
    ));
    await ok(asRole(probed, "gateway_rw", (tx) =>
      tx`INSERT INTO usage_logs (request_id, user_id, key_id, subscription_id, model, api_type, status, http_status, created_at)
         VALUES (gen_random_uuid(), ${fx.userId}, ${fx.keyId}, ${fx.subscriptionId}, 'm-a', 'openai-chat-completions', 'ok', 200, now())`,
    ));
    await ok(asRole(probed, "gateway_rw", (tx) =>
      tx`INSERT INTO usage_daily (user_id, day, model, requests)
         VALUES (${fx.userId}, current_date, 'm-a', 1)
         ON CONFLICT (user_id, day, model) DO UPDATE SET requests = usage_daily.requests + 1`,
    ));
    await ok(asRole(probed, "gateway_rw", (tx) =>
      tx`UPDATE upstream_pool_keys SET total_requests = total_requests + 1`,
    ));
    await ok(asRole(probed, "gateway_rw", (tx) =>
      tx`UPDATE virtual_api_keys SET last_used_at = now()`,
    ));

    // Nothing else may be written.
    await denied(asRole(probed, "gateway_rw", (tx) => tx`UPDATE subscriptions SET credits_limit = 1`));
    await denied(asRole(probed, "gateway_rw", (tx) => tx`DELETE FROM usage_daily`));
    await denied(asRole(probed, "gateway_rw", (tx) => tx`UPDATE plans SET credits_per_period = 0`));
    await denied(asRole(probed, "gateway_rw", (tx) => tx`DELETE FROM upstream_pool_keys`));
  });

  it("web_rw cannot read pool-key ciphertext and cannot touch usage or credits_used", async () => {
    await ok(asRole(probed, "web_rw", (tx) => tx`SELECT id, label, key_fingerprint FROM upstream_pool_keys`));
    await denied(asRole(probed, "web_rw", (tx) => tx`SELECT key_ciphertext FROM upstream_pool_keys`));
    await denied(asRole(probed, "web_rw", (tx) => tx`SELECT key_nonce FROM upstream_pool_keys`));
    await denied(asRole(probed, "web_rw", (tx) => tx`SELECT * FROM upstream_pool_keys`));

    // The admin create path is write-only but functional: INSERT with ciphertext works.
    const enc = encryptPoolKey("mock-upstream-key-web-insert", Buffer.alloc(32, 7));
    await ok(asRole(probed, "web_rw", (tx) =>
      tx`INSERT INTO upstream_pool_keys (provider_id, label, key_ciphertext, key_nonce, key_fingerprint)
         VALUES (${OPENCODE_GO_PROVIDER.id}, 'k-web', ${enc.keyCiphertext}, ${enc.keyNonce}, 'fp-web000')`,
    ));
    await denied(asRole(probed, "web_rw", (tx) => tx`UPDATE upstream_pool_keys SET key_ciphertext = key_ciphertext`));

    // Usage is gateway-written only; credits_used has a single writer.
    await denied(asRole(probed, "web_rw", (tx) =>
      tx`INSERT INTO usage_logs (request_id, user_id, key_id, subscription_id, model, api_type, status, http_status, created_at)
         VALUES (gen_random_uuid(), ${fx.userId}, ${fx.keyId}, ${fx.subscriptionId}, 'm', 'openai-chat-completions', 'ok', 200, now())`,
    ));
    await denied(asRole(probed, "web_rw", (tx) => tx`UPDATE usage_daily SET requests = 5`));
    await denied(asRole(probed, "web_rw", (tx) => tx`UPDATE subscriptions SET credits_used = 0`));
    await ok(asRole(probed, "web_rw", (tx) =>
      tx`UPDATE subscriptions SET expires_at = now() + interval '5 days'`,
    ));

    // Admin work is possible: plans, user status, adjustments.
    await ok(asRole(probed, "web_rw", (tx) => tx`UPDATE plans SET is_public = false WHERE id = 'plan-roles-test'`));
    await ok(asRole(probed, "web_rw", (tx) => tx`UPDATE users SET status = 'suspended' WHERE email = 'roles-test@test.local'`));
  });

  it("future usage_logs partitions are granted automatically", async () => {
    // The gateway runs this as a gateway_rw member (SECURITY DEFINER function) —
    // regression guard for the review finding that broke startup under the roles.
    await ok(asRole(probed, "gateway_rw", (tx) => tx`SELECT ensure_usage_log_partitions(2)`));
    await admin.sql`SELECT ensure_usage_log_partitions(2)`;
    const [latest] = await admin.sql<{ relname: string }[]>`
      SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'public.usage_logs'::regclass AND c.relname LIKE 'usage_logs_%'
      ORDER BY 1 DESC LIMIT 1`;
    const [priv] = await admin.sql<{ insert_granted: boolean; select_granted: boolean }[]>`
      SELECT has_table_privilege('gateway_rw', ${latest!.relname}, 'INSERT') AS insert_granted,
             has_table_privilege('web_rw', ${latest!.relname}, 'SELECT') AS select_granted`;
    expect(priv).toMatchObject({ insert_granted: true, select_granted: true });
  });
});
