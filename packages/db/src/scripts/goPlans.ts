/**
 * Go-only plan distribution (owner decision 2026-11-23).
 *
 * Run after migrations, with the DB env set:
 *   GO_EXTRA_KEY_ID=<id> OWNER_EMAIL=... pnpm --filter @deepcode/db go:plans
 *
 * What it guarantees:
 * - every public plan (free/trial/starter/pro/team) uses OpenCode Go models only;
 * - the owner has a private plan with the Go models plus every Synthetic model;
 * - selected Go models are active, routed and Go-weighted priced;
 * - stale Go routes for Synthetic `deepcode-*` models are disabled, so those names
 *   always resolve to Synthetic;
 * - the capacity check proves the top public plan x 10 fits the active Go keys.
 *
 * Idempotent: safe to run on every deploy.
 */
import { and, eq, like, sql } from "drizzle-orm";
import {
  GO_FREE_MODELS,
  GO_FREE_PLAN_CREDITS,
  GO_KEY_CREDITS,
  GO_MODEL_PRICES,
  GO_PRO_MODELS,
  GO_PUBLIC_PLAN_CREDITS,
  GO_STARTER_MODELS,
  GO_TEAM_MODELS,
  OPENCODE_GO_PROVIDER,
  OWNER_MODELS,
  OWNER_PLAN_CREDITS,
  OWNER_PLAN_ID,
  OWNER_SYNTHETIC_MODELS,
  TRIAL_HOURS,
  goWeightedCredits,
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
} from "../index.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}
const { db, close } = createDatabase(databaseUrl, { max: 1 });

const OWNER_EMAIL = (process.env.OWNER_EMAIL ?? "mohammedalsrkal@gmail.com").toLowerCase();
const GO_EXTRA_KEY_ID = process.env.GO_EXTRA_KEY_ID?.trim();
/** Safety target: the top plan must fit this many users on the active keys. */
const EXPECTED_USERS = Number(process.env.EXPECTED_USERS ?? 10);

/** Native wire format per Go model (the catalog's `api` field). */
const API_TYPE: Record<string, "openai-chat-completions" | "anthropic-messages" | "openai-responses" | "google-generative-ai"> = {
  gemini: "google-generative-ai",
  "claude-haiku-5-5": "anthropic-messages",
  "minimax-m3": "anthropic-messages",
  "minimax-m3.1-flash": "openai-chat-completions",
  "qwen3.7-plus": "anthropic-messages",
  "qwen3.8-flash": "anthropic-messages",
  "qwen3.8-max": "anthropic-messages",
  "qwen4-max": "anthropic-messages",
  "gpt-6-luna": "openai-responses",
  "gpt-5.6-luna": "openai-responses",
  "grok-4.7": "openai-responses",
};

const apiTypeOf = (id: string) =>
  API_TYPE[id] ?? (id.startsWith("gemini") ? "google-generative-ai" : "openai-chat-completions");

const displayNameOf = (id: string) =>
  id
    .split("-")
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");

try {
  await db
    .insert(upstreamProviders)
    .values({
      id: OPENCODE_GO_PROVIDER.id,
      displayName: OPENCODE_GO_PROVIDER.displayName,
      baseUrls: OPENCODE_GO_PROVIDER.baseUrls,
      sessionHeader: OPENCODE_GO_PROVIDER.sessionHeader,
      catalogFormat: OPENCODE_GO_PROVIDER.catalogFormat,
      modelsUrl: OPENCODE_GO_PROVIDER.modelsUrl,
      enabled: true,
      priority: 1,
    })
    .onConflictDoUpdate({
      target: upstreamProviders.id,
      set: {
        baseUrls: OPENCODE_GO_PROVIDER.baseUrls,
        sessionHeader: OPENCODE_GO_PROVIDER.sessionHeader,
        enabled: true,
        updatedAt: new Date(),
      },
    });

  // Every model offered by any Go plan (Synthetic names are handled separately).
  const goModels = [...new Set<string>([...GO_TEAM_MODELS])];
  for (const id of goModels) {
    const price = GO_MODEL_PRICES[id];
    const free = price?.monthlyLimitUsd === null;
    await db
      .insert(catalogModels)
      .values({
        id,
        displayName: displayNameOf(id),
        isFree: free,
        status: "active",
        sourceProviderId: OPENCODE_GO_PROVIDER.id,
        sortOrder: 50,
      })
      .onConflictDoUpdate({
        target: catalogModels.id,
        set: { status: "active", sourceProviderId: OPENCODE_GO_PROVIDER.id, updatedAt: new Date() },
      });

    await db
      .insert(modelRoutes)
      .values({
        model: id,
        providerId: OPENCODE_GO_PROVIDER.id,
        apiType: apiTypeOf(id),
        upstreamModel: id,
        priority: 0,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [modelRoutes.model, modelRoutes.providerId],
        set: { apiType: apiTypeOf(id), upstreamModel: id, enabled: true },
      });

    if (price) {
      const [input, output, cached] = goWeightedCredits(price);
      await db
        .insert(modelPrices)
        .values({
          model: id,
          inputPerMTok: input,
          outputPerMTok: output,
          cachedInputPerMTok: cached,
          effectiveFrom: new Date(0),
        })
        .onConflictDoUpdate({
          target: [modelPrices.model, modelPrices.effectiveFrom],
          set: { inputPerMTok: input, outputPerMTok: output, cachedInputPerMTok: cached },
        });
    }
  }

  // Synthetic names must never route to Go; otherwise the owner's `deepcode-*`
  // requests could be served by a provider that does not know those ids.
  await db
    .update(modelRoutes)
    .set({ enabled: false })
    .where(and(eq(modelRoutes.providerId, OPENCODE_GO_PROVIDER.id), like(modelRoutes.model, "deepcode-%")));

  // The owner's Synthetic routes stay enabled.
  for (const id of OWNER_SYNTHETIC_MODELS) {
    await db
      .update(modelRoutes)
      .set({ enabled: true })
      .where(and(eq(modelRoutes.model, id), eq(modelRoutes.providerId, "synthetic")));
  }

  const planRows = [
    {
      id: "free",
      tier: "free" as const,
      nameEn: "Free",
      nameAr: "مجاني",
      creditsPerPeriod: GO_FREE_PLAN_CREDITS,
      rpmLimit: 10,
      maxConcurrentStreams: 1,
      allowedModels: [...GO_FREE_MODELS],
      maxOutputTokens: 32_768,
      maxDevices: 1,
      maxKeys: 1,
      isPublic: true,
      sortOrder: 0,
    },
    {
      id: "trial",
      tier: "free" as const,
      nameEn: "Free trial",
      nameAr: "تجربة مجانية",
      creditsPerPeriod: GO_FREE_PLAN_CREDITS,
      rpmLimit: 10,
      maxConcurrentStreams: 1,
      allowedModels: [...GO_FREE_MODELS],
      maxOutputTokens: 32_768,
      maxDevices: 1,
      maxKeys: 1,
      isPublic: false,
      sortOrder: 0,
    },
    {
      id: "starter-monthly",
      tier: "starter" as const,
      nameEn: "Starter",
      nameAr: "المبتدئ",
      creditsPerPeriod: GO_PUBLIC_PLAN_CREDITS["starter-monthly"],
      rpmLimit: 30,
      maxConcurrentStreams: 2,
      allowedModels: [...GO_STARTER_MODELS],
      maxOutputTokens: 32_768,
      maxDevices: 2,
      maxKeys: 5,
      isPublic: true,
      sortOrder: 1,
    },
    {
      id: "pro-monthly",
      tier: "pro" as const,
      nameEn: "Pro",
      nameAr: "احترافي",
      creditsPerPeriod: GO_PUBLIC_PLAN_CREDITS["pro-monthly"],
      rpmLimit: 60,
      maxConcurrentStreams: 4,
      allowedModels: [...GO_PRO_MODELS],
      maxOutputTokens: 64_000,
      maxDevices: 3,
      maxKeys: 5,
      isPublic: true,
      sortOrder: 2,
    },
    {
      id: "team-monthly",
      tier: "team" as const,
      nameEn: "Team",
      nameAr: "الفريق",
      creditsPerPeriod: GO_PUBLIC_PLAN_CREDITS["team-monthly"],
      rpmLimit: 120,
      maxConcurrentStreams: 8,
      allowedModels: [...GO_TEAM_MODELS],
      maxOutputTokens: 64_000,
      maxDevices: 10,
      maxKeys: 10,
      isPublic: true,
      sortOrder: 3,
    },
    {
      id: OWNER_PLAN_ID,
      tier: "team" as const,
      nameEn: "Owner",
      nameAr: "المالك",
      creditsPerPeriod: OWNER_PLAN_CREDITS,
      rpmLimit: 120,
      maxConcurrentStreams: 8,
      allowedModels: [...OWNER_MODELS],
      maxOutputTokens: 64_000,
      maxDevices: 10,
      maxKeys: 10,
      isPublic: false,
      sortOrder: 99,
    },
  ];

  for (const plan of planRows) {
    await db
      .insert(plans)
      .values({ ...plan, priceCents: 0, currency: "INR", interval: "month" })
      .onConflictDoUpdate({
        target: plans.id,
        set: {
          allowedModels: plan.allowedModels,
          creditsPerPeriod: plan.creditsPerPeriod,
          rpmLimit: plan.rpmLimit,
          maxConcurrentStreams: plan.maxConcurrentStreams,
          maxOutputTokens: plan.maxOutputTokens,
          maxDevices: plan.maxDevices,
          maxKeys: plan.maxKeys,
          isPublic: plan.isPublic,
          updatedAt: new Date(),
        },
      });
  }

  // Owner keeps the Synthetic models on a private plan.
  const [owner] = await db.select().from(users).where(sql`lower(${users.email}) = ${OWNER_EMAIL}`);
  if (owner) {
    const [live] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, owner.id), sql`${subscriptions.status} in ('trialing','active','past_due')`))
      .limit(1);
    if (live) {
      await db
        .update(subscriptions)
        .set({ planId: OWNER_PLAN_ID, creditsLimit: OWNER_PLAN_CREDITS, updatedAt: new Date() })
        .where(eq(subscriptions.id, live.id));
    } else {
      await db.insert(subscriptions).values({
        userId: owner.id,
        planId: OWNER_PLAN_ID,
        status: "active",
        currentPeriodStart: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        creditsLimit: OWNER_PLAN_CREDITS,
        billingProvider: "manual",
        providerSubscriptionId: "owner",
      });
    }
  } else {
    console.warn(`owner user not found: ${OWNER_EMAIL}`);
  }

  if (GO_EXTRA_KEY_ID) {
    await db
      .update(upstreamPoolKeys)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(upstreamPoolKeys.id, GO_EXTRA_KEY_ID));
  }

  // Verification: public plans must never contain a Synthetic branded model.
  const publicPlans = await db.select().from(plans).where(eq(plans.isPublic, true));
  const synthetic = new Set<string>(OWNER_SYNTHETIC_MODELS);
  for (const plan of publicPlans) {
    const bad = plan.allowedModels.filter((m) => synthetic.has(m));
    if (bad.length > 0) throw new Error(`public plan ${plan.id} still has Synthetic models: ${bad.join(",")}`);
  }

  const goKeys = await db
    .select({ id: upstreamPoolKeys.id })
    .from(upstreamPoolKeys)
    .where(and(eq(upstreamPoolKeys.providerId, OPENCODE_GO_PROVIDER.id), eq(upstreamPoolKeys.status, "active")));
  const capacity = goKeys.length * GO_KEY_CREDITS;
  const topPlanUsers = GO_PUBLIC_PLAN_CREDITS["team-monthly"] * EXPECTED_USERS;
  if (capacity > 0 && topPlanUsers > capacity) {
    throw new Error(
      `capacity shortfall: ${EXPECTED_USERS} team users need ${topPlanUsers}, keys carry ${capacity}`,
    );
  }
  console.log(
    `go plans ready: ${goModels.length} Go models; ${goKeys.length} active Go keys (${capacity} credits); ` +
      `${EXPECTED_USERS} team users = ${topPlanUsers}; owner=${OWNER_EMAIL}; trial=${TRIAL_HOURS}h`,
  );
} finally {
  await close();
}
