import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  catalogModels,
  modelPrices,
  modelRoutes,
  upstreamProviders,
  type Database,
} from "@deepcode/db";
import type { UpstreamApiType } from "@deepcode/shared";
import { parseCatalog, usdPerMTokToCredits, type CatalogFormat, type NormalizedModel } from "./parse";

/**
 * Model sync (owner request 2026-11-15): pull a provider's model list and update
 * the DeepCode catalog. Rules that keep the owner in control:
 *  - New models are imported but are NOT added to any plan: users see a model
 *    only after the admin ticks it for a plan.
 *  - Our credit price is created once, at the upstream list price; it is never
 *    overwritten (admin edits win). Cost changes are reported, not applied.
 *  - Admin choices survive syncs: status hidden, badge, order, display name.
 *  - Ids matching the provider's hide pattern (Zen free models: OpenCode-client
 *    only) are imported hidden with a note.
 *  - Models the provider stopped listing become `retired` and their route from
 *    this provider is disabled; they are never deleted.
 */
export interface SyncReport {
  providerId: string;
  fetched: number;
  added: string[];
  updated: number;
  hidden: string[];
  retired: string[];
  restored: string[];
  skipped: Array<{ id: string; reason: string }>;
  costChanged: Array<{ id: string; upstreamInput: number; ourInputCredits: number }>;
}

export type FetchJson = (url: string) => Promise<unknown>;

export const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "deepcode-studio-catalog/1.0" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`models list returned HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 10 * 1024 * 1024) throw new Error("models list is too large");
  return JSON.parse(text) as unknown;
};

export async function syncProviderModels(
  handle: Database,
  providerId: string,
  deps: { fetchJson?: FetchJson; now?: Date } = {},
): Promise<SyncReport> {
  const now = deps.now ?? new Date();
  const [provider] = await handle.select().from(upstreamProviders).where(eq(upstreamProviders.id, providerId));
  if (!provider) throw new Error(`unknown provider ${providerId}`);
  if (provider.catalogFormat === "manual" || !provider.modelsUrl) {
    throw new Error("this provider has no models list (format manual or no models URL)");
  }
  if (!provider.modelsUrl.startsWith("https://")) throw new Error("models URL must use https");

  const supported = Object.keys(provider.baseUrls) as UpstreamApiType[];
  const defaultApi: UpstreamApiType = supported.includes("openai-chat-completions")
    ? "openai-chat-completions"
    : (supported[0] ?? "openai-chat-completions");
  const payload = await (deps.fetchJson ?? defaultFetchJson)(provider.modelsUrl);
  const parsed = parseCatalog(provider.catalogFormat as CatalogFormat, payload, defaultApi);
  const hide = provider.hideModelPattern ? safeRegex(provider.hideModelPattern) : null;

  const report: SyncReport = {
    providerId,
    fetched: parsed.models.length,
    added: [],
    updated: 0,
    hidden: [],
    retired: [],
    restored: [],
    skipped: [...parsed.skipped],
    costChanged: [],
  };

  const usable: Array<{ model: NormalizedModel; apiType: UpstreamApiType }> = [];
  for (const model of parsed.models) {
    // Prefer the model's native format; it must be one the provider has a base URL for.
    const api = model.apis.find((a) => supported.includes(a.apiType));
    if (!api) {
      report.skipped.push({ id: model.id, reason: `no base URL for ${model.apis.map((a) => a.apiType).join("/")}` });
      continue;
    }
    usable.push({ model, apiType: api.apiType });
  }

  await handle.transaction(async (tx) => {
    const ids = usable.map((u) => u.model.id);
    const existing = ids.length
      ? await tx.select().from(catalogModels).where(inArray(catalogModels.id, ids))
      : [];
    const byId = new Map(existing.map((e) => [e.id, e]));
    const latestPrices = ids.length
      ? await tx
          .select()
          .from(modelPrices)
          .where(inArray(modelPrices.model, ids))
          .orderBy(modelPrices.model, desc(modelPrices.effectiveFrom))
      : [];
    const priceById = new Map<string, (typeof latestPrices)[number]>();
    for (const p of latestPrices) if (!priceById.has(p.model)) priceById.set(p.model, p);

    for (const { model, apiType } of usable) {
      const prior = byId.get(model.id);
      const hiddenBySync = hide?.test(model.id) ?? false;
      const facts = {
        description: model.description,
        family: model.family,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        inputModalities: model.inputModalities,
        capabilities: model.capabilities,
        upstreamCostUsd: model.cost,
        isFree: model.isFree,
        trainsOnData: model.trainsOnData,
        lastSeenAt: now,
        updatedAt: now,
      };
      if (!prior) {
        await tx.insert(catalogModels).values({
          id: model.id,
          displayName: model.displayName,
          ...facts,
          status: hiddenBySync ? "hidden" : "active",
          note: hiddenBySync ? `Hidden by the ${provider.displayName} sync rule` : null,
          sourceProviderId: provider.id,
        });
        report.added.push(model.id);
      } else {
        const status = prior.status === "retired" ? (hiddenBySync ? "hidden" : "active") : prior.status;
        if (prior.status === "retired") report.restored.push(model.id);
        await tx
          .update(catalogModels)
          .set({
            ...facts,
            status,
            sourceProviderId: prior.sourceProviderId ?? provider.id,
            // A name still equal to the id was never customised: take the upstream name.
            ...(prior.displayName === prior.id ? { displayName: model.displayName } : {}),
          })
          .where(eq(catalogModels.id, model.id));
        report.updated += 1;
      }
      if (hiddenBySync) report.hidden.push(model.id);

      await tx
        .insert(modelRoutes)
        .values({ model: model.id, providerId: provider.id, apiType, upstreamModel: model.id, priority: 0, enabled: true })
        .onConflictDoUpdate({
          target: [modelRoutes.model, modelRoutes.providerId],
          set: { apiType, upstreamModel: model.id, enabled: true },
        });

      const price = priceById.get(model.id);
      if (!price && model.cost) {
        await tx.insert(modelPrices).values({
          model: model.id,
          inputPerMTok: usdPerMTokToCredits(model.cost.input),
          outputPerMTok: usdPerMTokToCredits(model.cost.output),
          cachedInputPerMTok: usdPerMTokToCredits(model.cost.cacheRead ?? model.cost.input),
          effectiveFrom: now,
        });
      } else if (price && model.cost && Number(price.inputPerMTok) !== usdPerMTokToCredits(model.cost.input)) {
        report.costChanged.push({
          id: model.id,
          upstreamInput: model.cost.input,
          ourInputCredits: Number(price.inputPerMTok),
        });
      }
    }

    // Models this provider used to serve but no longer lists.
    const gone = await tx
      .select({ model: modelRoutes.model })
      .from(modelRoutes)
      .where(
        and(
          eq(modelRoutes.providerId, provider.id),
          eq(modelRoutes.enabled, true),
          ids.length ? notInArray(modelRoutes.model, ids) : sql`true`,
        ),
      );
    for (const { model } of gone) {
      await tx
        .update(modelRoutes)
        .set({ enabled: false })
        .where(and(eq(modelRoutes.model, model), eq(modelRoutes.providerId, provider.id)));
      // Retire the catalog entry only when no other provider still serves it.
      const [other] = await tx
        .select({ model: modelRoutes.model })
        .from(modelRoutes)
        .where(and(eq(modelRoutes.model, model), eq(modelRoutes.enabled, true)))
        .limit(1);
      if (!other) {
        await tx
          .update(catalogModels)
          .set({ status: "retired", note: `No longer listed by ${provider.displayName}`, updatedAt: now })
          .where(eq(catalogModels.id, model));
        report.retired.push(model);
      }
    }

    await tx.update(upstreamProviders).set({ lastSyncedAt: now, updatedAt: now }).where(eq(upstreamProviders.id, provider.id));
  });

  return report;
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
