/**
 * Switch a database to the Synthetic.new upstream (owner decision 2026-11-16):
 *  - Synthetic provider on (priority 1); OpenCode providers and their pool keys off;
 *  - the branded DeepCode models (packages/db/src/catalog.ts SYNTHETIC_MODELS) with
 *    their route, catalog facts and credit price (Synthetic's discounted rate, cached
 *    input at 25%);
 *  - OpenCode-era catalog models hidden; plans offer exactly SYNTHETIC_PLAN_MODELS.
 * Uses the audited admin library where one exists. Idempotent.
 *
 *   node --conditions=@deepcode/source --import tsx scripts/apply-synthetic-catalog.mts           # dry run
 *   node --conditions=@deepcode/source --import tsx scripts/apply-synthetic-catalog.mts --apply   # write
 *
 * Needs DATABASE_URL and ADMIN_EMAIL (the admin the audit rows are attributed to).
 */
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  catalogModels,
  modelPrices,
  modelRoutes,
  plans,
  upstreamPoolKeys,
  upstreamProviders,
  users,
  SYNTHETIC_MODELS,
  SYNTHETIC_PLAN_MODELS,
  SYNTHETIC_PROVIDER,
  syntheticCredits,
} from "@deepcode/db";
import { db } from "../src/lib/db";
import { setModelPrice } from "../src/lib/modelAdmin";
import { setPoolKeyStatus } from "../src/lib/adminActions";
import { audit } from "../src/lib/audit";

const apply = process.argv.includes("--apply");
const h = db().db;
const say = (msg: string) => console.log(`${apply ? "" : "[dry run] "}${msg}`);
const [admin] = await h.select().from(users).where(eq(users.email, process.env.ADMIN_EMAIL ?? ""));
if (!admin || admin.role !== "admin") throw new Error("ADMIN_EMAIL must name an admin account");
const actor = { id: admin.id };

// 1. Providers
say(`provider ${SYNTHETIC_PROVIDER.id}: enable, priority 1`);
if (apply) {
  await h
    .insert(upstreamProviders)
    .values({ ...SYNTHETIC_PROVIDER, enabled: true, priority: 1 })
    .onConflictDoUpdate({
      target: upstreamProviders.id,
      set: { baseUrls: SYNTHETIC_PROVIDER.baseUrls, enabled: true, priority: 1, sessionHeader: null, updatedAt: new Date() },
    });
}
const opencode = (await h.select().from(upstreamProviders)).filter((p) => p.id.startsWith("opencode"));
for (const p of opencode) {
  say(`provider ${p.id}: disable (was ${p.enabled ? "on" : "off"})`);
  if (apply) await h.update(upstreamProviders).set({ enabled: false, updatedAt: new Date() }).where(eq(upstreamProviders.id, p.id));
  const keys = await h.select().from(upstreamPoolKeys).where(and(eq(upstreamPoolKeys.providerId, p.id), eq(upstreamPoolKeys.status, "active")));
  for (const k of keys) {
    say(`  pool key ${k.label} (${k.keyFingerprint}): disable`);
    if (apply) {
      const r = await setPoolKeyStatus(h, actor, { keyId: k.id, status: "disabled" });
      if (!r.ok) throw new Error(`disable key ${k.id}: ${r.code}`);
    }
  }
}

// 2. Branded models
const ids = SYNTHETIC_MODELS.map((m) => m.id);
const latest = new Map<string, typeof modelPrices.$inferSelect>();
for (const p of await h.select().from(modelPrices).where(inArray(modelPrices.model, ids)).orderBy(modelPrices.model, desc(modelPrices.effectiveFrom))) {
  if (!latest.has(p.model)) latest.set(p.model, p);
}
for (const m of SYNTHETIC_MODELS) {
  const [input, output, cached] = syntheticCredits(m);
  const facts = {
    displayName: m.displayName,
    description: m.description,
    family: "deepcode",
    contextWindow: m.contextWindow,
    inputModalities: m.vision ? ["text", "image"] : ["text"],
    capabilities: { tools: true, reasoning: true, vision: m.vision, structuredOutput: true },
    isFree: m.usd[0] === 0 && m.usd[1] === 0,
    trainsOnData: false,
    status: "active" as const,
    note: null,
    badge: m.badge ?? null,
    sortOrder: m.sortOrder,
    sourceProviderId: SYNTHETIC_PROVIDER.id,
  };
  const cur = latest.get(m.id);
  const samePrice = cur && Number(cur.inputPerMTok) === input && Number(cur.outputPerMTok) === output && Number(cur.cachedInputPerMTok) === cached;
  say(`model ${m.id.padEnd(20)} → ${m.upstreamModel.padEnd(26)} credits/MTok ${input}/${output}/${cached}${samePrice ? " (price unchanged)" : ""}`);
  if (!apply) continue;
  await h
    .insert(catalogModels)
    .values({ id: m.id, ...facts })
    .onConflictDoUpdate({ target: catalogModels.id, set: { ...facts, updatedAt: new Date() } });
  await h
    .insert(modelRoutes)
    .values({ model: m.id, providerId: SYNTHETIC_PROVIDER.id, apiType: "openai-chat-completions", upstreamModel: m.upstreamModel, priority: 0, enabled: true })
    .onConflictDoUpdate({
      target: [modelRoutes.model, modelRoutes.providerId],
      set: { apiType: "openai-chat-completions", upstreamModel: m.upstreamModel, enabled: true },
    });
  if (!samePrice) {
    const r = await setModelPrice(h, actor, { id: m.id, input, output, cached });
    if (!r.ok) throw new Error(`price ${m.id}: ${r.code}`);
  }
}

// 3. Hide every non-DeepCode (OpenCode-era) model so nothing else is listed or served.
const others = await h.select({ id: catalogModels.id }).from(catalogModels).where(and(notInArray(catalogModels.id, ids), eq(catalogModels.status, "active")));
say(`hide ${others.length} OpenCode-era models`);
if (apply && others.length > 0) {
  await h
    .update(catalogModels)
    .set({ status: "hidden", note: "Replaced by the Synthetic.new DeepCode models (2026-11-16).", updatedAt: new Date() })
    .where(inArray(catalogModels.id, others.map((o) => o.id)));
}

// 4. Plans
for (const [planId, models] of Object.entries(SYNTHETIC_PLAN_MODELS)) {
  const [plan] = await h.select().from(plans).where(eq(plans.id, planId));
  if (!plan) {
    say(`plan ${planId}: not found, skipped`);
    continue;
  }
  say(`plan ${planId}: models ${plan.allowedModels.length} → ${models.join(", ")}`);
  if (!apply) continue;
  await h.update(plans).set({ allowedModels: models, updatedAt: new Date() }).where(eq(plans.id, plan.id));
  await audit(h, { actorId: actor.id, action: "plan.models.set", targetType: "plan", targetId: plan.id, metadata: { models, reason: "synthetic" } });
}
await audit(h, { actorId: actor.id, action: "upstream.switch", targetType: "provider", targetId: SYNTHETIC_PROVIDER.id, metadata: { applied: apply } }).catch(() => {});
console.log(apply ? "applied — restart or reload the gateway to pick it up" : "dry run (pass --apply to write)");
process.exit(0);
