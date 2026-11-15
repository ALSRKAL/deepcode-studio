import { and, desc, eq, lte } from "drizzle-orm";
import type { ModelPrice, UpstreamApiType } from "@deepcode/shared";
import { catalogModels, modelPrices, modelRoutes, upstreamProviders, type Database } from "@deepcode/db";

export interface ProviderInfo {
  id: string;
  baseUrls: Partial<Record<UpstreamApiType, string>>;
  sessionHeader: string | null;
  isFallback: boolean;
  priority: number;
}

/** What clients are told about a model (GET /v1/models, the desktop model picker). */
export interface ModelInfo {
  id: string;
  name: string;
  description: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  capabilities: { tools?: boolean; reasoning?: boolean; vision?: boolean; structuredOutput?: boolean };
  free: boolean;
  badge: string | null;
  sortOrder: number;
  status: "active" | "hidden" | "retired";
}

export interface Route {
  model: string;
  provider: ProviderInfo;
  apiType: UpstreamApiType;
  upstreamModel: string;
  priority: number;
}

/**
 * In-memory copy of providers, routes and current prices. Refreshed every 60 s and
 * on demand (web admin publishes a reload). Reads never hit Postgres.
 */
export class Catalog {
  #routes = new Map<string, Route[]>();
  #prices = new Map<string, ModelPrice>();
  #providers = new Map<string, ProviderInfo>();
  #models = new Map<string, ModelInfo>();

  constructor(private readonly db: Database) {}

  async reload(now = new Date()): Promise<void> {
    const providers = await this.db.select().from(upstreamProviders).where(eq(upstreamProviders.enabled, true));
    const providerMap = new Map<string, ProviderInfo>(
      providers.map((p) => [
        p.id,
        { id: p.id, baseUrls: p.baseUrls, sessionHeader: p.sessionHeader, isFallback: p.isFallback, priority: p.priority },
      ]),
    );

    const routes = await this.db.select().from(modelRoutes).where(eq(modelRoutes.enabled, true));
    const routeMap = new Map<string, Route[]>();
    for (const r of routes) {
      const provider = providerMap.get(r.providerId);
      if (!provider || !provider.baseUrls[r.apiType]) continue;
      const list = routeMap.get(r.model) ?? [];
      list.push({ model: r.model, provider, apiType: r.apiType, upstreamModel: r.upstreamModel, priority: r.priority });
      routeMap.set(r.model, list);
    }
    // Primary providers before fallbacks, then by priority (lower first).
    for (const list of routeMap.values()) {
      list.sort(
        (a, b) =>
          Number(a.provider.isFallback) - Number(b.provider.isFallback) ||
          a.priority - b.priority ||
          a.provider.priority - b.provider.priority,
      );
    }

    // Latest price whose effective_from has passed, per model.
    const priceRows = await this.db
      .select()
      .from(modelPrices)
      .where(and(lte(modelPrices.effectiveFrom, now)))
      .orderBy(modelPrices.model, desc(modelPrices.effectiveFrom));
    const priceMap = new Map<string, ModelPrice>();
    for (const p of priceRows) {
      if (!priceMap.has(p.model)) {
        priceMap.set(p.model, {
          inputPerMTok: p.inputPerMTok,
          cachedInputPerMTok: p.cachedInputPerMTok,
          outputPerMTok: p.outputPerMTok,
        });
      }
    }

    const modelRows = await this.db.select().from(catalogModels);
    const modelMap = new Map<string, ModelInfo>(
      modelRows.map((m) => [
        m.id,
        {
          id: m.id,
          name: m.displayName,
          description: m.description,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          inputModalities: m.inputModalities,
          capabilities: m.capabilities,
          free: m.isFree,
          badge: m.badge,
          sortOrder: m.sortOrder,
          status: m.status,
        },
      ]),
    );

    this.#providers = providerMap;
    this.#routes = routeMap;
    this.#prices = priceMap;
    this.#models = modelMap;
  }

  routes(model: string): Route[] {
    return this.#routes.get(model) ?? [];
  }

  price(model: string): ModelPrice | undefined {
    return this.#prices.get(model);
  }

  /**
   * Models that have at least one enabled route and a price, and that the admin
   * has not hidden or the upstream retired (catalog_models.status). Models with no
   * catalog row (older installs) stay servable.
   */
  isServable(model: string): boolean {
    const info = this.#models.get(model);
    return this.routes(model).length > 0 && this.#prices.has(model) && (!info || info.status === "active");
  }

  info(model: string): ModelInfo | undefined {
    return this.#models.get(model);
  }

  provider(id: string): ProviderInfo | undefined {
    return this.#providers.get(id);
  }
}
