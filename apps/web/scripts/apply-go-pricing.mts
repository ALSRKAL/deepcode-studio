/**
 * Apply the OpenCode Go allowance-weighted credit prices and the plan layout
 * (packages/db/src/catalog.ts: GO_MODEL_PRICES, GO_PLAN_LAYOUT) to a database,
 * through the same admin library code as /admin/models and /admin/plans (audited).
 *
 *   node --conditions=@deepcode/source --import tsx scripts/apply-go-pricing.mts           # dry run
 *   node --conditions=@deepcode/source --import tsx scripts/apply-go-pricing.mts --apply   # write
 *
 * Needs DATABASE_URL and ADMIN_EMAIL (the admin the audit rows are attributed to).
 * Prices are history rows (effective now); plan prices in money are not touched.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { catalogModels, modelPrices, plans, users, GO_MODEL_PRICES, GO_PLAN_LAYOUT, goWeightedCredits } from "@deepcode/db";
import { db } from "../src/lib/db";
import { setModelPrice, updatePlan } from "../src/lib/modelAdmin";
import { audit } from "../src/lib/audit";

const apply = process.argv.includes("--apply");
const h = db().db;
const [admin] = await h.select().from(users).where(eq(users.email, process.env.ADMIN_EMAIL ?? ""));
if (!admin || admin.role !== "admin") throw new Error("ADMIN_EMAIL must name an admin account");
const actor = { id: admin.id };

const ids = Object.keys(GO_MODEL_PRICES);
// Only active catalog models: retired ones (e.g. Go dropped them) are neither priced nor offered.
const known = new Set(
  (await h.select({ id: catalogModels.id, status: catalogModels.status }).from(catalogModels).where(inArray(catalogModels.id, ids)))
    .filter((r) => r.status === "active")
    .map((r) => r.id),
);
const latest = new Map<string, typeof modelPrices.$inferSelect>();
for (const p of await h.select().from(modelPrices).where(inArray(modelPrices.model, ids)).orderBy(modelPrices.model, desc(modelPrices.effectiveFrom))) {
  if (!latest.has(p.model)) latest.set(p.model, p);
}

console.log("model                     tier      in/out/cached credits per 1M (was → now)");
for (const id of ids) {
  if (!known.has(id)) {
    console.log(`${id.padEnd(25)} skipped: not in this catalog`);
    continue;
  }
  const [i, o, c] = goWeightedCredits(GO_MODEL_PRICES[id]!);
  const cur = latest.get(id);
  const was = cur ? `${cur.inputPerMTok}/${cur.outputPerMTok}/${cur.cachedInputPerMTok}` : "none";
  const same = cur && Number(cur.inputPerMTok) === i && Number(cur.outputPerMTok) === o && Number(cur.cachedInputPerMTok) === c;
  console.log(`${id.padEnd(25)} ${GO_MODEL_PRICES[id]!.tier.padEnd(9)} ${was} → ${i}/${o}/${c}${same ? " (unchanged)" : ""}`);
  if (apply && !same) {
    const r = await setModelPrice(h, actor, { id, input: i, output: o, cached: c });
    if (!r.ok) throw new Error(`price ${id}: ${r.code}`);
  }
}

for (const [planId, layout] of Object.entries(GO_PLAN_LAYOUT)) {
  const [plan] = await h.select().from(plans).where(eq(plans.id, planId));
  if (!plan) {
    console.log(`plan ${planId}: skipped, not found`);
    continue;
  }
  const models = layout.allowedModels.filter((m) => known.has(m));
  console.log(`plan ${planId}: credits ${plan.creditsPerPeriod} → ${layout.creditsPerPeriod}; models ${plan.allowedModels.length} → ${models.length}`);
  if (!apply) continue;
  const r = await updatePlan(h, actor, {
    id: plan.id,
    nameEn: plan.nameEn,
    nameAr: plan.nameAr,
    priceMinor: plan.priceCents,
    currency: plan.currency,
    creditsPerPeriod: layout.creditsPerPeriod,
    rpmLimit: plan.rpmLimit,
    maxConcurrentStreams: plan.maxConcurrentStreams,
    maxKeys: plan.maxKeys,
    maxDevices: plan.maxDevices,
    maxOutputTokens: plan.maxOutputTokens,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
    fallbackEnabled: plan.fallbackEnabled,
  });
  if (!r.ok) throw new Error(`plan ${planId}: ${r.code}`);
  await h.update(plans).set({ allowedModels: models, updatedAt: new Date() }).where(eq(plans.id, plan.id));
  await audit(h, { actorId: actor.id, action: "plan.models.set", targetType: "plan", targetId: plan.id, metadata: { models } });
}
console.log(apply ? "applied" : "dry run (pass --apply to write)");
process.exit(0);
