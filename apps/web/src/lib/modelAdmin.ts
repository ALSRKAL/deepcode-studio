import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  catalogModels,
  modelPrices,
  modelRoutes,
  plans,
  upstreamPoolKeys,
  upstreamProviders,
  type Database,
} from "@deepcode/db";
import { UPSTREAM_API_TYPES, type UpstreamApiType } from "@deepcode/shared";
import { audit } from "./audit";
import { MODEL_ID } from "./modelCatalog/parse";

/**
 * Admin control of providers, the model catalog and plan access (owner request
 * 2026-11-15). Plain functions over the database (tested directly); server
 * actions in actions/models.ts add the admin guard and cache invalidation.
 */
export type Actor = { id: string; ip?: string };
type Result = { ok: true } | { ok: false; code: string };

// ---- providers ----------------------------------------------------------------

const httpsUrl = z.string().trim().url().refine((u) => u.startsWith("https://"), "https only");
export const ProviderInputSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  displayName: z.string().trim().min(1).max(80),
  baseUrls: z.partialRecord(z.enum(UPSTREAM_API_TYPES), httpsUrl).refine((r) => Object.keys(r).length > 0, "at least one base URL"),
  catalogFormat: z.enum(["opencode", "openai", "manual"]),
  modelsUrl: httpsUrl.nullable(),
  hideModelPattern: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .refine((p) => {
      if (!p) return true;
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    }, "invalid regular expression"),
  sessionHeader: z.string().trim().regex(/^[a-z0-9-]{1,60}$/i).nullable(),
  enabled: z.boolean(),
  isFallback: z.boolean(),
  priority: z.number().int().min(0).max(1000),
});
export type ProviderInput = z.infer<typeof ProviderInputSchema>;

export async function saveProvider(handle: Database, actor: Actor, input: ProviderInput): Promise<Result> {
  const parsed = ProviderInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const p = parsed.data;
  await handle
    .insert(upstreamProviders)
    .values({ ...p, baseUrls: p.baseUrls as Partial<Record<UpstreamApiType, string>> })
    .onConflictDoUpdate({
      target: upstreamProviders.id,
      set: { ...p, baseUrls: p.baseUrls as Partial<Record<UpstreamApiType, string>>, updatedAt: new Date() },
    });
  await audit(handle, { actorId: actor.id, action: "provider.save", targetType: "provider", targetId: p.id, metadata: { enabled: p.enabled }, ip: actor.ip });
  return { ok: true };
}

export async function listProvidersForAdmin(handle: Database) {
  const providers = await handle.select().from(upstreamProviders).orderBy(asc(upstreamProviders.priority), asc(upstreamProviders.id));
  const keyCounts = await handle
    .select({ providerId: upstreamPoolKeys.providerId, active: sql<number>`count(*) filter (where ${upstreamPoolKeys.status} = 'active')::int`, total: sql<number>`count(*)::int` })
    .from(upstreamPoolKeys)
    .groupBy(upstreamPoolKeys.providerId);
  const routeCounts = await handle
    .select({ providerId: modelRoutes.providerId, models: sql<number>`count(*) filter (where ${modelRoutes.enabled})::int` })
    .from(modelRoutes)
    .groupBy(modelRoutes.providerId);
  return providers.map((p) => ({
    ...p,
    activeKeys: keyCounts.find((k) => k.providerId === p.id)?.active ?? 0,
    totalKeys: keyCounts.find((k) => k.providerId === p.id)?.total ?? 0,
    routedModels: routeCounts.find((r) => r.providerId === p.id)?.models ?? 0,
  }));
}

// ---- catalog --------------------------------------------------------------------

export interface AdminModelRow {
  id: string;
  displayName: string;
  description: string | null;
  status: "active" | "hidden" | "retired";
  note: string | null;
  badge: string | null;
  sortOrder: number;
  isFree: boolean;
  trainsOnData: boolean;
  contextWindow: number | null;
  capabilities: { tools?: boolean; reasoning?: boolean; vision?: boolean };
  upstreamCostUsd: { input: number; output: number; cacheRead?: number; variable?: boolean } | null;
  price: { input: number; output: number; cached: number } | null;
  providers: string[];
  planIds: string[];
}

export async function listModelsForAdmin(
  handle: Database,
  filter: { q?: string; provider?: string; free?: boolean; status?: "active" | "hidden" | "retired" | "all" } = {},
): Promise<AdminModelRow[]> {
  const models = await handle.select().from(catalogModels).orderBy(asc(catalogModels.sortOrder), asc(catalogModels.id));
  const routes = await handle.select().from(modelRoutes).where(eq(modelRoutes.enabled, true));
  const priceRows = await handle.select().from(modelPrices).orderBy(modelPrices.model, desc(modelPrices.effectiveFrom));
  const latest = new Map<string, (typeof priceRows)[number]>();
  for (const p of priceRows) if (!latest.has(p.model) && p.effectiveFrom.getTime() <= Date.now()) latest.set(p.model, p);
  const planRows = await handle.select({ id: plans.id, allowed: plans.allowedModels }).from(plans);

  const q = filter.q?.trim().toLowerCase();
  return models
    .map((m) => {
      const price = latest.get(m.id);
      return {
        id: m.id,
        displayName: m.displayName,
        description: m.description,
        status: m.status,
        note: m.note,
        badge: m.badge,
        sortOrder: m.sortOrder,
        isFree: m.isFree,
        trainsOnData: m.trainsOnData,
        contextWindow: m.contextWindow,
        capabilities: m.capabilities,
        upstreamCostUsd: m.upstreamCostUsd,
        price: price
          ? { input: Number(price.inputPerMTok), output: Number(price.outputPerMTok), cached: Number(price.cachedInputPerMTok) }
          : null,
        providers: routes.filter((r) => r.model === m.id).map((r) => r.providerId),
        planIds: planRows.filter((p) => p.allowed.includes(m.id)).map((p) => p.id),
      };
    })
    .filter((m) => (filter.status && filter.status !== "all" ? m.status === filter.status : m.status !== "retired"))
    .filter((m) => (filter.free ? m.isFree : true))
    .filter((m) => (filter.provider ? m.providers.includes(filter.provider) : true))
    .filter((m) => (q ? m.id.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q) : true));
}

export const ModelUpdateSchema = z.object({
  id: z.string().regex(MODEL_ID),
  displayName: z.string().trim().min(1).max(120),
  status: z.enum(["active", "hidden"]),
  badge: z.enum(["", "new", "recommended", "beta"]).transform((b) => b || null),
  sortOrder: z.number().int().min(0).max(10_000),
});

export async function updateModel(handle: Database, actor: Actor, input: z.input<typeof ModelUpdateSchema>): Promise<Result> {
  const parsed = ModelUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const { id, ...set } = parsed.data;
  const [row] = await handle
    .update(catalogModels)
    .set({ ...set, ...(set.status === "active" ? { note: null } : {}), updatedAt: new Date() })
    .where(and(eq(catalogModels.id, id), sql`${catalogModels.status} <> 'retired'`))
    .returning({ id: catalogModels.id });
  if (!row) return { ok: false, code: "not_found" };
  await audit(handle, { actorId: actor.id, action: "model.update", targetType: "model", targetId: id, metadata: set, ip: actor.ip });
  return { ok: true };
}

const credits = z.number().int().min(0).max(1_000_000_000);
export async function setModelPrice(
  handle: Database,
  actor: Actor,
  input: { id: string; input: number; output: number; cached: number; now?: Date },
): Promise<Result> {
  if (!MODEL_ID.test(input.id) || ![input.input, input.output, input.cached].every((v) => credits.safeParse(v).success)) {
    return { ok: false, code: "invalid_input" };
  }
  const [exists] = await handle.select({ id: catalogModels.id }).from(catalogModels).where(eq(catalogModels.id, input.id));
  if (!exists) return { ok: false, code: "not_found" };
  // Prices are history: a new row effective now; settled usage keeps its old price.
  await handle.insert(modelPrices).values({
    model: input.id,
    inputPerMTok: input.input,
    outputPerMTok: input.output,
    cachedInputPerMTok: input.cached,
    effectiveFrom: input.now ?? new Date(),
  });
  await audit(handle, { actorId: actor.id, action: "model.price", targetType: "model", targetId: input.id, metadata: { input: input.input, output: input.output, cached: input.cached }, ip: actor.ip });
  return { ok: true };
}

/** Exactly these plans offer the model (others stop offering it). */
export async function setModelPlans(handle: Database, actor: Actor, input: { id: string; planIds: string[] }): Promise<Result> {
  if (!MODEL_ID.test(input.id)) return { ok: false, code: "invalid_input" };
  const [model] = await handle.select({ id: catalogModels.id, status: catalogModels.status }).from(catalogModels).where(eq(catalogModels.id, input.id));
  if (!model) return { ok: false, code: "not_found" };
  if (model.status === "retired" && input.planIds.length > 0) return { ok: false, code: "retired" };
  await handle.transaction(async (tx) => {
    await tx
      .update(plans)
      .set({ allowedModels: sql`array_remove(${plans.allowedModels}, ${input.id})`, updatedAt: new Date() })
      .where(sql`${input.id} = any(${plans.allowedModels})`);
    if (input.planIds.length > 0) {
      await tx
        .update(plans)
        .set({ allowedModels: sql`array_append(${plans.allowedModels}, ${input.id})`, updatedAt: new Date() })
        .where(inArray(plans.id, input.planIds));
    }
  });
  await audit(handle, { actorId: actor.id, action: "model.plans", targetType: "model", targetId: input.id, metadata: { planIds: input.planIds }, ip: actor.ip });
  return { ok: true };
}

/** Bulk: add every active model matching the selection to one plan. */
export async function addModelsToPlan(
  handle: Database,
  actor: Actor,
  input: { planId: string; selection: "free" | "provider"; providerId?: string },
): Promise<Result & { added?: number }> {
  const rows = await listModelsForAdmin(handle, {
    status: "active",
    free: input.selection === "free",
    ...(input.selection === "provider" && input.providerId ? { provider: input.providerId } : {}),
  });
  const ids = rows.filter((r) => r.price && r.providers.length > 0 && !r.trainsOnData).map((r) => r.id);
  const [plan] = await handle.select().from(plans).where(eq(plans.id, input.planId));
  if (!plan) return { ok: false, code: "not_found" };
  const merged = [...new Set([...plan.allowedModels, ...ids])];
  await handle.update(plans).set({ allowedModels: merged, updatedAt: new Date() }).where(eq(plans.id, plan.id));
  await audit(handle, { actorId: actor.id, action: "plan.models.bulk_add", targetType: "plan", targetId: plan.id, metadata: { selection: input.selection, providerId: input.providerId ?? null, added: merged.length - plan.allowedModels.length }, ip: actor.ip });
  return { ok: true, added: merged.length - plan.allowedModels.length };
}

// ---- plans -----------------------------------------------------------------------

export const PlanUpdateSchema = z.object({
  id: z.string().min(1).max(100),
  nameEn: z.string().trim().min(1).max(60),
  nameAr: z.string().trim().min(1).max(60),
  priceMinor: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().toUpperCase().length(3),
  creditsPerPeriod: z.number().int().min(0).max(1_000_000_000_000),
  rpmLimit: z.number().int().min(1).max(10_000),
  maxConcurrentStreams: z.number().int().min(1).max(100),
  maxKeys: z.number().int().min(0).max(1000),
  maxDevices: z.number().int().min(1).max(100),
  maxOutputTokens: z.number().int().min(1).max(10_000_000).nullable(),
  isPublic: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  fallbackEnabled: z.boolean(),
});

export async function updatePlan(handle: Database, actor: Actor, input: z.input<typeof PlanUpdateSchema>): Promise<Result> {
  const parsed = PlanUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const { id, priceMinor, ...rest } = parsed.data;
  const [row] = await handle
    .update(plans)
    .set({ ...rest, priceCents: priceMinor, updatedAt: new Date() })
    .where(eq(plans.id, id))
    .returning({ id: plans.id });
  if (!row) return { ok: false, code: "not_found" };
  await audit(handle, { actorId: actor.id, action: "plan.update", targetType: "plan", targetId: id, metadata: { priceMinor, ...rest }, ip: actor.ip });
  return { ok: true };
}
