import { describe, expect, it } from "vitest";
import {
  computeCredits,
  daysLeft,
  normalizeUsage,
  percentUsed,
  SubscriptionStatusResponseSchema,
} from "../src/index.js";
import {
  generateVirtualKey,
  hashesEqual,
  hashVirtualKey,
  isWellFormedVirtualKey,
  virtualKeyDisplayParts,
} from "../src/node/index.js";

const pepper = Buffer.alloc(32, 7);

describe("virtual keys (G-01)", () => {
  it("generates well-formed, unique keys", () => {
    const keys = new Set(Array.from({ length: 500 }, generateVirtualKey));
    expect(keys.size).toBe(500);
    for (const key of keys) expect(isWellFormedVirtualKey(key)).toBe(true);
  });

  it("rejects malformed keys", () => {
    for (const bad of ["", "sk-dc-", "sk-dc-short", `sk-xx-${"a".repeat(43)}`, `sk-dc-${"a".repeat(42)}!`]) {
      expect(isWellFormedVirtualKey(bad)).toBe(false);
    }
  });

  it("hashes deterministically with the pepper and compares in constant time", () => {
    const key = generateVirtualKey();
    const a = hashVirtualKey(key, pepper);
    expect(hashesEqual(a, hashVirtualKey(key, pepper))).toBe(true);
    expect(hashesEqual(a, hashVirtualKey(key, Buffer.alloc(32, 8)))).toBe(false);
    expect(a.length).toBe(32);
  });

  it("refuses a short pepper", () => {
    expect(() => hashVirtualKey(generateVirtualKey(), Buffer.alloc(8))).toThrow();
  });

  it("exposes only prefix and last four characters for display", () => {
    const key = generateVirtualKey();
    const parts = virtualKeyDisplayParts(key);
    expect(parts.keyPrefix).toBe(key.slice(0, 10));
    expect(parts.last4).toHaveLength(4);
  });
});

describe("credits", () => {
  const price = { inputPerMTok: 3_000_000, cachedInputPerMTok: 300_000, outputPerMTok: 15_000_000 };

  it("bills uncached input, cached input and output separately", () => {
    // 10k input of which 4k cached, 2k output:
    // 6000*3e6 + 4000*3e5 + 2000*15e6 = 1.8e10 + 1.2e9 + 3e10 = 4.92e10 micro -> 49200 credits
    expect(computeCredits({ input: 10_000, cachedInput: 4_000, output: 2_000, reasoning: 500 }, price)).toBe(49_200);
  });

  it("rounds up partial credits", () => {
    expect(computeCredits({ input: 1, cachedInput: 0, output: 0, reasoning: 0 }, price)).toBe(3);
    expect(computeCredits({ input: 1, cachedInput: 0, output: 0, reasoning: 0 }, { ...price, inputPerMTok: 1 })).toBe(1);
  });

  it("normalises invalid usage instead of producing negative charges", () => {
    expect(normalizeUsage({ input: -5, cachedInput: 99, output: Number.NaN, reasoning: 3 })).toEqual({
      input: 0,
      cachedInput: 0,
      output: 0,
      reasoning: 0,
    });
    expect(computeCredits({ input: 10, cachedInput: 50, output: 0, reasoning: 0 }, price)).toBe(3);
  });

  it("computes percentage and days left at the boundaries (G-26)", () => {
    expect(percentUsed(0, 100)).toBe(0);
    expect(percentUsed(371, 1000)).toBe(37.1);
    expect(percentUsed(1500, 1000)).toBe(100);
    expect(percentUsed(5, 0)).toBe(100);
    const now = new Date("2026-11-14T00:00:00Z");
    expect(daysLeft(new Date(now.getTime() + 1000), now)).toBe(1);
    expect(daysLeft(new Date(now.getTime() + 86_400_000), now)).toBe(1);
    expect(daysLeft(new Date(now.getTime() + 86_401_000), now)).toBe(2);
    expect(daysLeft(new Date(now.getTime() - 1), now)).toBe(0);
  });
});

describe("contracts", () => {
  it("accepts a valid status response and rejects a malformed one", () => {
    const valid = {
      plan: { id: "pro-monthly", tier: "pro", name: { en: "Pro", ar: "احترافي" } },
      status: "active",
      credits: { limit: 100, used: 10, remaining: 90, percentUsed: 10 },
      period: { startsAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", daysLeft: 17 },
      limits: { rpm: 60, allowedModels: ["glm-5.3"] },
      lock: null,
      serverTime: "2026-11-14T10:22:31Z",
    };
    expect(SubscriptionStatusResponseSchema.safeParse(valid).success).toBe(true);
    expect(SubscriptionStatusResponseSchema.safeParse({ ...valid, status: "unknown" }).success).toBe(false);
  });
});
