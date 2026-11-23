/**
 * Idempotent "free tier on OpenCode Go" setup (owner decision 2026-11-23).
 *
 * Run after migrations:
 *   OPENCODE_GO_API_KEYS=oc_sk_... pnpm --filter @deepcode/db go:free
 *
 * - enables the OpenCode Go provider and adds the env key(s) to the encrypted pool
 * - publishes `hy4-flash-free` ($0) and `deepseek-v4.1-flash` (metered) with routes
 *   and Go-weighted prices
 * - points the Free plan and the 24-hour Trial at exactly those two models, and
 *   makes Free public so the app/website can offer it
 *
 * Safe to run repeatedly: nothing is deleted, existing keys are matched by
 * fingerprint, and prices are written at the epoch like the dev seed.
 */
import { and, eq } from "drizzle-orm";
import { encryptPoolKey, parseEncryptionKey, poolKeyFingerprint } from "@deepcode/shared/node";
import {
  GO_FREE_MODELS,
  GO_FREE_PLAN_CREDITS,
  GO_MODEL_PRICES,
  OPENCODE_GO_PROVIDER,
  PLACEHOLDER_PLANS,
  goWeightedCredits,
} from "../catalog.js";
import {
  catalogModels,
  createDatabase,
  modelPrices,
  modelRoutes,
  plans,
  upstreamPoolKeys,
  upstreamProviders,
} from "../index.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}
const { db, close } = createDatabase(databaseUrl, { max: 1 });

/** Catalog facts from the live Go catalog (read 2026-11-23). */
const MODEL_META = {
  "hy4-flash-free": {
    displayName: "Hy4 Flash Free",
    description: "Tencent Hy4 Flash, free on Go: everyday agent work with images and a 1M context.",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputModalities: ["text", "image"],
    capabilities: { tools: true, reasoning: true, vision: true },
    isFree: true,
    sortOrder: 5,
  },
  "deepseek-v4.1-flash": {
    displayName: "DeepSeek Flash",
    description: "DeepSeek V4.1 Flash: strong reasoning, coding and vision at a low price.",
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    inputModalities: ["text", "image"],
    capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true },
    isFree: false,
    sortOrder: 6,
  },
};

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
        catalogFormat: OPENCODE_GO_PROVIDER.catalogFormat,
        modelsUrl: OPENCODE_GO_PROVIDER.modelsUrl,
        enabled: true,
        updatedAt: new Date(),
      },
    });

  for (const id of GO_FREE_MODELS) {
    const meta = MODEL_META[id];
    await db
      .insert(catalogModels)
      .values({ id, sourceProviderId: OPENCODE_GO_PROVIDER.id, status: "active", ...meta })
      .onConflictDoUpdate({
        target: catalogModels.id,
        set: {
          displayName: meta.displayName,
          description: meta.description,
          contextWindow: meta.contextWindow,
          maxOutputTokens: meta.maxOutputTokens,
          inputModalities: meta.inputModalities,
          capabilities: meta.capabilities,
          isFree: meta.isFree,
          status: "active",
          sortOrder: meta.sortOrder,
          sourceProviderId: OPENCODE_GO_PROVIDER.id,
          updatedAt: new Date(),
        },
      });

    await db
      .insert(modelRoutes)
      .values({
        model: id,
        providerId: OPENCODE_GO_PROVIDER.id,
        apiType: "openai-chat-completions",
        upstreamModel: id,
        priority: 0,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [modelRoutes.model, modelRoutes.providerId],
        set: {
          apiType: "openai-chat-completions",
          upstreamModel: id,
          priority: 0,
          enabled: true,
        },
      });

    // Free model: zero credits. Paid model: Go-weighted (peak) credits.
    const goPrice = GO_MODEL_PRICES[id];
    const [input, output, cached] = goPrice ? goWeightedCredits(goPrice) : [0, 0, 0];
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
        set: {
          inputPerMTok: input,
          outputPerMTok: output,
          cachedInputPerMTok: cached,
        },
      });
  }

  const freeBase = PLACEHOLDER_PLANS.find((p) => p.id === "free")!;
  await db
    .insert(plans)
    .values({ ...freeBase, isPublic: true, allowedModels: [...GO_FREE_MODELS] })
    .onConflictDoUpdate({
      target: plans.id,
      set: {
        isPublic: true,
        allowedModels: [...GO_FREE_MODELS],
        creditsPerPeriod: GO_FREE_PLAN_CREDITS,
        maxOutputTokens: 32_768,
        maxConcurrentStreams: 1,
        rpmLimit: 10,
        maxDevices: 1,
        maxKeys: 1,
        updatedAt: new Date(),
      },
    });

  await db
    .update(plans)
    .set({
      allowedModels: [...GO_FREE_MODELS],
      creditsPerPeriod: GO_FREE_PLAN_CREDITS,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, "trial"));

  // Keys: OPENCODE_GO_API_KEYS for deployment, SEED_POOL_KEYS for a dev seed.
  const raw = process.env.OPENCODE_GO_API_KEYS ?? process.env.SEED_POOL_KEYS ?? "";
  const keys = raw.split(",").map((k) => k.trim()).filter((k) => k.length >= 8);
  let added = 0;
  if (keys.length > 0) {
    const encryptionKey = parseEncryptionKey(
      process.env.POOL_KEY_ENCRYPTION_KEY?.trim() || (() => {
        throw new Error("POOL_KEY_ENCRYPTION_KEY is required to add keys");
      })(),
    );
    const existing = await db
      .select({ id: upstreamPoolKeys.id, fp: upstreamPoolKeys.keyFingerprint })
      .from(upstreamPoolKeys);
    for (const [i, key] of keys.entries()) {
      const fingerprint = poolKeyFingerprint(key);
      const match = existing.find((r) => r.fp === fingerprint);
      if (match) {
        await db
          .update(upstreamPoolKeys)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(upstreamPoolKeys.id, match.id), eq(upstreamPoolKeys.status, "disabled")));
        continue;
      }
      await db.insert(upstreamPoolKeys).values({
        providerId: OPENCODE_GO_PROVIDER.id,
        label: `OpenCode Go (free #${i + 1})`,
        ...encryptPoolKey(key, encryptionKey),
        keyFingerprint: fingerprint,
        weight: 1,
        maxConcurrency: 8,
      });
      existing.push({ id: "", fp: fingerprint });
      added += 1;
    }
  }

  console.log(
    `go free setup complete: models ${GO_FREE_MODELS.join(", ")}; free plan credits ${GO_FREE_PLAN_CREDITS}; keys added ${added}`,
  );
} finally {
  await close();
}
