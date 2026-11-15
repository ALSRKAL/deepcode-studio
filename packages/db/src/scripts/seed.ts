/**
 * Idempotent development seed. Safe to run repeatedly.
 * - upserts the OpenCode Go provider, model routes, prices and placeholder plans
 * - creates admin@deepcode.local and dev@deepcode.local if missing
 * - gives dev@ an active Pro subscription and, if it has no key yet, prints a new key ONCE
 * - optionally loads SEED_POOL_KEYS (comma-separated) into the pool, encrypted
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  encryptPoolKey,
  generateVirtualKey,
  hashVirtualKey,
  parseEncryptionKey,
  poolKeyFingerprint,
  virtualKeyDisplayParts,
} from "@deepcode/shared/node";
import {
  CATALOG_MODELS,
  OPENCODE_GO_PROVIDER,
  OPENCODE_ZEN_PROVIDER,
  OPENROUTER_PROVIDER,
  PLACEHOLDER_PLANS,
  usdPerMTokToCredits,
} from "../catalog.js";
import {
  catalogModels,
  createDatabase,
  modelPrices,
  modelRoutes,
  plans,
  subscriptions,
  upstreamPoolKeys,
  upstreamProviders,
  users,
  virtualApiKeys,
} from "../index.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set (see .env.example)`);
    process.exit(1);
  }
  return value;
}

const { db, close } = createDatabase(requireEnv("DATABASE_URL"), { max: 1 });
const pepper = Buffer.from(requireEnv("KEY_HASH_PEPPER"), "base64");

try {
  await db
    .insert(upstreamProviders)
    .values(OPENCODE_GO_PROVIDER)
    .onConflictDoUpdate({
      target: upstreamProviders.id,
      set: {
        baseUrls: OPENCODE_GO_PROVIDER.baseUrls,
        sessionHeader: OPENCODE_GO_PROVIDER.sessionHeader,
        catalogFormat: OPENCODE_GO_PROVIDER.catalogFormat,
        modelsUrl: OPENCODE_GO_PROVIDER.modelsUrl,
        updatedAt: new Date(),
      },
    });
  // Presets the admin can enable later (keys + "Sync models" in /admin/providers).
  for (const preset of [OPENCODE_ZEN_PROVIDER, OPENROUTER_PROVIDER]) {
    await db.insert(upstreamProviders).values({ ...preset, enabled: false, isFallback: true, priority: 10 }).onConflictDoNothing();
  }

  for (const m of CATALOG_MODELS) {
    // Minimal catalog facts so the gateway/admin work offline; "Sync models" fills the rest.
    await db
      .insert(catalogModels)
      .values({
        id: m.id,
        displayName: m.id,
        isFree: m.free === true,
        trainsOnData: m.trainsOnPrompts === true,
        sourceProviderId: OPENCODE_GO_PROVIDER.id,
      })
      .onConflictDoNothing();
    await db
      .insert(modelRoutes)
      .values({ model: m.id, providerId: OPENCODE_GO_PROVIDER.id, apiType: m.apiType, upstreamModel: m.id })
      .onConflictDoUpdate({
        target: [modelRoutes.model, modelRoutes.providerId],
        set: { apiType: m.apiType, upstreamModel: m.id },
      });
    const [input, output, cached] = m.usd;
    // effective_from fixed at the epoch for seed rows, so re-running does not stack price history.
    await db
      .insert(modelPrices)
      .values({
        model: m.id,
        inputPerMTok: usdPerMTokToCredits(input),
        outputPerMTok: usdPerMTokToCredits(output),
        cachedInputPerMTok: usdPerMTokToCredits(cached),
        effectiveFrom: new Date(0),
      })
      .onConflictDoUpdate({
        target: [modelPrices.model, modelPrices.effectiveFrom],
        set: {
          inputPerMTok: usdPerMTokToCredits(input),
          outputPerMTok: usdPerMTokToCredits(output),
          cachedInputPerMTok: usdPerMTokToCredits(cached),
        },
      });
  }

  // SEED_PRODUCTION=1 (hosted deploy, docs/deploy/README.ar.md): plans are created
  // once in INR and never overwritten (prices are then edited in /admin/plans),
  // and no dev/test users or keys are created.
  const production = process.env.SEED_PRODUCTION === "1";
  const INR_PLACEHOLDER_PRICES: Record<string, number> = {
    free: 0,
    "starter-monthly": 49_900,
    "pro-monthly": 149_900,
    "team-monthly": 399_900,
  };
  for (const base of PLACEHOLDER_PLANS) {
    const plan = production
      ? {
          ...base,
          currency: "INR",
          priceCents: INR_PLACEHOLDER_PRICES[base.id] ?? base.priceCents,
          // The hosted product sells paid plans only (owner decision 2026-11-16);
          // the free plan row stays for admin assignment but is never listed.
          ...(base.id === "free" ? { isPublic: false } : {}),
        }
      : base;
    const insert = db.insert(plans).values(plan);
    await (production
      ? insert.onConflictDoNothing({ target: plans.id })
      : insert.onConflictDoUpdate({ target: plans.id, set: { ...plan, updatedAt: new Date() } }));
  }

  const ensureUser = async (email: string, role: "user" | "admin") => {
    const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (existing) return existing;
    const [created] = await db.insert(users).values({ email, role, emailVerified: true }).returning();
    return created!;
  };
  if (!production) {
    await ensureUser("admin@deepcode.local", "admin");
    const dev = await ensureUser("dev@deepcode.local", "user");

    const [live] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, dev.id), inArray(subscriptions.status, ["trialing", "active", "past_due"])));
    if (!live) {
      const now = new Date();
      const pro = PLACEHOLDER_PLANS.find((p) => p.id === "pro-monthly")!;
      await db.insert(subscriptions).values({
        userId: dev.id,
        planId: pro.id,
        status: "active",
        currentPeriodStart: now,
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        creditsLimit: pro.creditsPerPeriod,
      });
    }

    const [devKey] = await db.select({ id: virtualApiKeys.id }).from(virtualApiKeys).where(eq(virtualApiKeys.userId, dev.id));
    if (!devKey) {
      const key = generateVirtualKey();
      await db.insert(virtualApiKeys).values({
        userId: dev.id,
        keyHash: hashVirtualKey(key, pepper).toString("hex"),
        ...virtualKeyDisplayParts(key),
        name: "seed dev key",
        kind: "api",
      });
      // Shown once, like the dashboard will. Not written to any file.
      console.log(`dev@deepcode.local API key (shown once): ${key}`);
    }
  }

  const poolKeys = (process.env.SEED_POOL_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (poolKeys.length > 0) {
    const encryptionKey = parseEncryptionKey(requireEnv("POOL_KEY_ENCRYPTION_KEY"));
    const existing = new Set(
      (await db.select({ fp: upstreamPoolKeys.keyFingerprint }).from(upstreamPoolKeys)).map((r) => r.fp),
    );
    let added = 0;
    for (const [i, plaintext] of poolKeys.entries()) {
      if (existing.has(poolKeyFingerprint(plaintext))) continue;
      await db.insert(upstreamPoolKeys).values({
        providerId: OPENCODE_GO_PROVIDER.id,
        label: `go-account-${String(i + 1).padStart(2, "0")}`,
        ...encryptPoolKey(plaintext, encryptionKey),
      });
      added += 1;
    }
    console.log(`pool keys added: ${added}, already present: ${poolKeys.length - added}`);
  }

  const unverified = CATALOG_MODELS.filter((m) => !m.verified).length;
  console.log(`seed complete. ${unverified} model prices are PLACEHOLDERS (see packages/db/src/catalog.ts).`);
} finally {
  await close();
}
