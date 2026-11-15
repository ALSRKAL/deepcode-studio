import { readFileSync } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPENCODE_GO_PROVIDER, auditLogs, catalogModels, modelPrices, plans, upstreamProviders } from "@deepcode/db";
import {
  addModelsToPlan,
  listModelsForAdmin,
  listProvidersForAdmin,
  saveProvider,
  setModelPlans,
  setModelPrice,
  updateModel,
  updatePlan,
} from "@/lib/modelAdmin";
import { syncProviderModels } from "@/lib/modelCatalog/sync";
import { seedWorld } from "./helpers/world.js";

const GO = JSON.parse(readFileSync(new URL("./fixtures/opencode-go-models.json", import.meta.url), "utf8")) as unknown;

/** Admin control of models, prices and plan access (owner request 2026-11-15). */
describe("model administration", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;
  let other: Awaited<ReturnType<typeof seedWorld>>;
  const actor = { id: "", ip: "127.0.0.1" };
  const db = () => world.handle.db;

  beforeAll(async () => {
    world = await seedWorld();
    other = await seedWorld({ tier: "free", priceCents: 0 });
    actor.id = world.user.id;
    await db().insert(upstreamProviders).values(OPENCODE_GO_PROVIDER).onConflictDoUpdate({ target: upstreamProviders.id, set: OPENCODE_GO_PROVIDER });
    await syncProviderModels(db(), "opencode-go", { fetchJson: async () => GO });
  });
  afterAll(async () => {
    await other.handle.close();
    await world.handle.close();
  });

  it("puts a model in exactly the chosen plans", async () => {
    expect(await setModelPlans(db(), actor, { id: "glm-5.3-flash", planIds: [world.plan.id, other.plan.id] })).toEqual({ ok: true });
    expect(await setModelPlans(db(), actor, { id: "glm-5.3-flash", planIds: [world.plan.id, other.plan.id] })).toEqual({ ok: true });
    let [p1] = await db().select().from(plans).where(eq(plans.id, world.plan.id));
    expect(p1!.allowedModels.filter((m) => m === "glm-5.3-flash")).toHaveLength(1); // no duplicates
    await setModelPlans(db(), actor, { id: "glm-5.3-flash", planIds: [other.plan.id] });
    [p1] = await db().select().from(plans).where(eq(plans.id, world.plan.id));
    const [p2] = await db().select().from(plans).where(eq(plans.id, other.plan.id));
    expect(p1!.allowedModels).not.toContain("glm-5.3-flash");
    expect(p2!.allowedModels).toContain("glm-5.3-flash");
    const row = (await listModelsForAdmin(db(), { q: "glm-5.3-flash" })).find((m) => m.id === "glm-5.3-flash")!;
    expect(row.planIds).toContain(other.plan.id);
    expect(row.providers).toContain("opencode-go");
  });

  it("bulk-adds free models, skipping ones that train on prompts", async () => {
    const r = await addModelsToPlan(db(), actor, { planId: other.plan.id, selection: "free" });
    expect(r.ok).toBe(true);
    const [p] = await db().select().from(plans).where(eq(plans.id, other.plan.id));
    expect(p!.allowedModels).toEqual(expect.arrayContaining(["beam-free", "longcat-2.5-free"]));
    expect(p!.allowedModels).not.toContain("iceman-contributor-free");
  });

  it("price changes are new history rows; invalid prices are refused", async () => {
    expect(await setModelPrice(db(), actor, { id: "deepseek-v4.1-flash", input: 200_000, output: 800_000, cached: 4_000, now: new Date(Date.now() + 5) })).toEqual({ ok: true });
    const prices = await db().select().from(modelPrices).where(eq(modelPrices.model, "deepseek-v4.1-flash")).orderBy(desc(modelPrices.effectiveFrom));
    expect(Number(prices[0]!.inputPerMTok)).toBe(200_000);
    expect(prices.length).toBeGreaterThanOrEqual(2);
    expect(await setModelPrice(db(), actor, { id: "deepseek-v4.1-flash", input: -1, output: 1, cached: 1 })).toEqual({ ok: false, code: "invalid_input" });
    expect(await setModelPrice(db(), actor, { id: "no-such-model", input: 1, output: 1, cached: 1 })).toEqual({ ok: false, code: "not_found" });
  });

  it("hides a model, labels it, and refuses retired models in plans", async () => {
    expect(await updateModel(db(), actor, { id: "hy3", displayName: "Hunyuan 3", status: "hidden", badge: "beta", sortOrder: 5 })).toEqual({ ok: true });
    const [m] = await db().select().from(catalogModels).where(eq(catalogModels.id, "hy3"));
    expect(m).toMatchObject({ displayName: "Hunyuan 3", status: "hidden", badge: "beta", sortOrder: 5 });
    await db().update(catalogModels).set({ status: "retired" }).where(eq(catalogModels.id, "hy3"));
    expect(await setModelPlans(db(), actor, { id: "hy3", planIds: [world.plan.id] })).toEqual({ ok: false, code: "retired" });
    expect(await updateModel(db(), actor, { id: "hy3", displayName: "x", status: "active", badge: "", sortOrder: 1 })).toEqual({ ok: false, code: "not_found" });
  });

  it("edits every plan field and validates input", async () => {
    const r = await updatePlan(db(), actor, {
      id: world.plan.id,
      nameEn: "Pro+",
      nameAr: "احترافي+",
      priceMinor: 149_900,
      currency: "inr",
      creditsPerPeriod: 30_000_000,
      rpmLimit: 90,
      maxConcurrentStreams: 5,
      maxKeys: 10,
      maxDevices: 4,
      maxOutputTokens: 64_000,
      isPublic: true,
      sortOrder: 2,
      fallbackEnabled: true,
    });
    expect(r).toEqual({ ok: true });
    const [p] = await db().select().from(plans).where(eq(plans.id, world.plan.id));
    expect(p).toMatchObject({ nameEn: "Pro+", priceCents: 149_900, currency: "INR", rpmLimit: 90, maxOutputTokens: 64_000, fallbackEnabled: true });
    expect((await updatePlan(db(), actor, { ...p!, priceMinor: -5, maxOutputTokens: null })).ok).toBe(false);
  });

  it("validates providers (https only, valid regex) and lists key/model counts", async () => {
    const base = {
      id: "my-router",
      displayName: "My Router",
      baseUrls: { "openai-chat-completions": "https://router.example/v1" },
      catalogFormat: "openai" as const,
      modelsUrl: "https://router.example/v1/models",
      hideModelPattern: null,
      sessionHeader: null,
      enabled: false,
      isFallback: true,
      priority: 30,
    };
    expect(await saveProvider(db(), actor, base)).toEqual({ ok: true });
    expect(await saveProvider(db(), actor, { ...base, baseUrls: { "openai-chat-completions": "http://router.example/v1" } })).toEqual({ ok: false, code: "invalid_input" });
    expect(await saveProvider(db(), actor, { ...base, hideModelPattern: "(" })).toEqual({ ok: false, code: "invalid_input" });
    const list = await listProvidersForAdmin(db());
    expect(list.find((p) => p.id === "opencode-go")!.routedModels).toBeGreaterThanOrEqual(25);
    expect(list.find((p) => p.id === "my-router")).toMatchObject({ enabled: false, activeKeys: 0 });
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.action, "provider.save"));
    expect(audits.length).toBeGreaterThan(0);
  });
});
