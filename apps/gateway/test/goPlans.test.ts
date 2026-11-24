import { describe, expect, it } from "vitest";
import {
  GO_FREE_MODELS,
  GO_KEY_CREDITS,
  GO_PRO_MODELS,
  GO_PUBLIC_PLAN_CREDITS,
  GO_STARTER_MODELS,
  GO_TEAM_MODELS,
  OWNER_MODELS,
  OWNER_SYNTHETIC_MODELS,
  TRIAL_PLAN,
} from "@deepcode/db";

/**
 * Go-only public plans (owner decision 2026-11-23): users run on OpenCode Go,
 * the owner keeps Synthetic. These invariants protect billing and routing.
 */
describe("Go plan distribution", () => {
  it("public plans are Go-only and never include Synthetic branded models", () => {
    const synthetic = new Set<string>(OWNER_SYNTHETIC_MODELS);
    for (const plan of [GO_FREE_MODELS, GO_STARTER_MODELS, GO_PRO_MODELS, GO_TEAM_MODELS]) {
      for (const id of plan) expect(synthetic.has(id)).toBe(false);
    }
    const ownerSynthetic = new Set<string>(OWNER_SYNTHETIC_MODELS);
    const team = new Set<string>(GO_TEAM_MODELS);
    for (const id of OWNER_MODELS) expect(ownerSynthetic.has(id) || team.has(id)).toBe(true);
  });

  it("tiers nest: starter ⊆ pro ⊆ team", () => {
    const starter = new Set<string>(GO_STARTER_MODELS);
    const pro = new Set<string>(GO_PRO_MODELS);
    const team = new Set<string>(GO_TEAM_MODELS);
    for (const id of starter) expect(pro.has(id)).toBe(true);
    for (const id of pro) expect(team.has(id)).toBe(true);
  });

  it("the top plan x 10 fits a single Go key", () => {
    expect(GO_PUBLIC_PLAN_CREDITS["team-monthly"] * 10).toBeLessThanOrEqual(GO_KEY_CREDITS);
  });

  it("trial keeps every free plan model plus HungerG Free", () => {
    for (const id of GO_FREE_MODELS) expect(TRIAL_PLAN.allowedModels).toContain(id);
    expect(TRIAL_PLAN.allowedModels).toContain("hungerg-free");
  });
});
