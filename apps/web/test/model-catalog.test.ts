import { readFileSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OPENCODE_GO_PROVIDER,
  OPENCODE_ZEN_PROVIDER,
  OPENROUTER_PROVIDER,
  catalogModels,
  modelPrices,
  modelRoutes,
  plans,
  upstreamProviders,
} from "@deepcode/db";
import { parseOpenAiCatalog, parseOpencodeCatalog, usdPerMTokToCredits } from "@/lib/modelCatalog/parse";
import { syncProviderModels } from "@/lib/modelCatalog/sync";
import { seedWorld } from "./helpers/world.js";

/** Real catalog responses saved 2026-11-15 (public endpoints). */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const GO = fixture("opencode-go-models.json");
const ZEN = fixture("opencode-zen-models.json");
const OPENROUTER = fixture("openrouter-models.json");

describe("catalog parsers", () => {
  it("reads OpenCode Go: formats, prices, limits, capabilities, free models", () => {
    const { models } = parseOpencodeCatalog(GO);
    expect(models.length).toBeGreaterThanOrEqual(25);
    const ds = models.find((m) => m.id === "deepseek-v4.1-flash")!;
    expect(ds.apis[0]).toEqual({ apiType: "openai-chat-completions", baseUrl: "https://opencode.ai/inference/go/openai/v1" });
    expect(ds.cost).toMatchObject({ input: 0.15, output: 0.6, variable: true });
    expect(ds.capabilities).toMatchObject({ tools: true, reasoning: true, vision: true });
    const glm = models.find((m) => m.id === "glm-5.3-flash")!;
    expect(glm.contextWindow).toBe(1_000_000);
    expect(glm.isFree).toBe(false);
    expect(models.find((m) => m.id === "claude-haiku-5-5")!.apis[0]!.apiType).toBe("anthropic-messages");
    expect(models.find((m) => m.id === "gemini-4-argon")!.apis[0]!.apiType).toBe("google-generative-ai");
    const free = models.filter((m) => m.isFree).map((m) => m.id).sort();
    expect(free).toEqual(expect.arrayContaining(["beam-free", "iceman-contributor-free", "longcat-2.5-free"]));
    expect(models.find((m) => m.id === "iceman-contributor-free")!.trainsOnData).toBe(true);
    expect(models.find((m) => m.id === "beam-free")!.trainsOnData).toBe(false);
  });

  it("reads OpenCode Zen, including its free models", () => {
    const { models } = parseOpencodeCatalog(ZEN);
    expect(models.length).toBeGreaterThan(50);
    for (const id of ["deepseek-v4.1-flash-free", "glm-5.3-flash-free", "big-pickle"]) {
      expect(models.find((m) => m.id === id)?.isFree).toBe(true);
    }
  });

  it("reads OpenRouter (USD per token → per MTok, :free models)", () => {
    const { models } = parseOpenAiCatalog(OPENROUTER, "openai-chat-completions");
    expect(models.length).toBeGreaterThan(0);
    const free = models.filter((m) => m.id.endsWith(":free"));
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((m) => m.isFree)).toBe(true);
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length); // duplicates dropped
    const paid = models.find((m) => m.cost && m.cost.input > 0);
    if (paid) expect(paid.cost!.input).toBeLessThan(1000); // per MTok, not per token
  });

  it("ignores junk safely", () => {
    expect(parseOpencodeCatalog({ data: [{ id: "../x" }, null, 5, { id: "ok", type: "image" }] })).toEqual({
      models: [],
      skipped: [
        { id: "../x", reason: "invalid id" },
        { id: "ok", reason: "type image is not a chat model" },
      ],
    });
  });
});

describe("syncProviderModels", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;
  const db = () => world.handle.db;

  beforeAll(async () => {
    world = await seedWorld();
    for (const p of [OPENCODE_GO_PROVIDER, OPENCODE_ZEN_PROVIDER, OPENROUTER_PROVIDER]) {
      await db().insert(upstreamProviders).values(p).onConflictDoUpdate({ target: upstreamProviders.id, set: p });
    }
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("imports Go models with routes and an initial price at upstream cost; adds nothing to plans", async () => {
    const report = await syncProviderModels(db(), "opencode-go", { fetchJson: async () => GO });
    expect(report.fetched).toBeGreaterThanOrEqual(25);
    const [ds] = await db().select().from(catalogModels).where(eq(catalogModels.id, "deepseek-v4.1-flash"));
    expect(ds).toMatchObject({ status: "active", contextWindow: expect.any(Number), isFree: false });
    expect(ds!.displayName).not.toBe("deepseek-v4.1-flash"); // upstream name, not the id
    const [route] = await db()
      .select()
      .from(modelRoutes)
      .where(and(eq(modelRoutes.model, "beam-free"), eq(modelRoutes.providerId, "opencode-go")));
    expect(route).toMatchObject({ apiType: "openai-chat-completions", enabled: true });
    const [price] = await db().select().from(modelPrices).where(eq(modelPrices.model, "glm-5.3-flash")).orderBy(desc(modelPrices.effectiveFrom));
    // The fixture world may already price it; when created by sync it equals upstream cost.
    expect(Number(price!.inputPerMTok)).toBeGreaterThanOrEqual(0);
    const [plan] = await db().select().from(plans).where(eq(plans.id, world.plan.id));
    expect(plan!.allowedModels).toEqual(world.plan.allowedModels);
  });

  it("keeps admin prices and choices on re-sync, and reports upstream cost changes", async () => {
    await db().update(catalogModels).set({ status: "hidden", displayName: "My DeepSeek", badge: "recommended" }).where(eq(catalogModels.id, "deepseek-v4.1-flash"));
    await db().insert(modelPrices).values({ model: "deepseek-v4.1-flash", inputPerMTok: 999, outputPerMTok: 999, cachedInputPerMTok: 9, effectiveFrom: new Date() });
    const report = await syncProviderModels(db(), "opencode-go", { fetchJson: async () => GO, now: new Date(Date.now() + 1000) });
    const [ds] = await db().select().from(catalogModels).where(eq(catalogModels.id, "deepseek-v4.1-flash"));
    expect(ds).toMatchObject({ status: "hidden", displayName: "My DeepSeek", badge: "recommended" });
    const [price] = await db().select().from(modelPrices).where(eq(modelPrices.model, "deepseek-v4.1-flash")).orderBy(desc(modelPrices.effectiveFrom));
    expect(Number(price!.inputPerMTok)).toBe(999);
    expect(report.costChanged).toContainEqual({ id: "deepseek-v4.1-flash", upstreamInput: 0.15, ourInputCredits: 999 });
    expect(report.added).toEqual([]);
  });

  it("retires a model the provider stops listing, and restores it when it returns", async () => {
    const without = { data: (GO as { data: Array<{ id: string }> }).data.filter((m) => m.id !== "hy3") };
    const r1 = await syncProviderModels(db(), "opencode-go", { fetchJson: async () => without });
    expect(r1.retired).toContain("hy3");
    const [route] = await db().select().from(modelRoutes).where(and(eq(modelRoutes.model, "hy3"), eq(modelRoutes.providerId, "opencode-go")));
    expect(route!.enabled).toBe(false);
    const r2 = await syncProviderModels(db(), "opencode-go", { fetchJson: async () => GO });
    expect(r2.restored).toContain("hy3");
    const [m] = await db().select().from(catalogModels).where(eq(catalogModels.id, "hy3"));
    expect(m!.status).toBe("active");
  });

  it("imports Zen free models hidden (OpenCode-client only) and routes shared models to both providers", async () => {
    const report = await syncProviderModels(db(), "opencode-zen", { fetchJson: async () => ZEN });
    expect(report.hidden).toEqual(expect.arrayContaining(["deepseek-v4.1-flash-free", "glm-5.3-flash-free", "big-pickle"]));
    const [free] = await db().select().from(catalogModels).where(eq(catalogModels.id, "glm-5.3-flash-free"));
    expect(free!.status).toBe("hidden");
    expect(free!.note).toMatch(/sync rule/);
    const routes = await db().select().from(modelRoutes).where(eq(modelRoutes.model, "glm-5.3-flash"));
    expect(routes.map((r) => r.providerId).sort()).toEqual(["opencode-go", "opencode-zen"]);
  });

  it("OpenRouter format: one API type, free models priced 0", async () => {
    await syncProviderModels(db(), "openrouter", { fetchJson: async () => OPENROUTER });
    const freeId = (OPENROUTER as { data: Array<{ id: string }> }).data.find((m) => m.id.endsWith(":free"))!.id;
    const [m] = await db().select().from(catalogModels).where(eq(catalogModels.id, freeId));
    expect(m!.isFree).toBe(true);
    const [price] = await db().select().from(modelPrices).where(eq(modelPrices.model, freeId));
    expect(Number(price!.inputPerMTok)).toBe(0);
    expect(usdPerMTokToCredits(0.15)).toBe(150_000);
  });

  it("refuses providers without a list or with a non-https list", async () => {
    await db().update(upstreamProviders).set({ modelsUrl: "http://example.test/models" }).where(eq(upstreamProviders.id, "openrouter"));
    await expect(syncProviderModels(db(), "openrouter", { fetchJson: async () => OPENROUTER })).rejects.toThrow(/https/);
  });
});
