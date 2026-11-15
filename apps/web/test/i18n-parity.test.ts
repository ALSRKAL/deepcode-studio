import { describe, expect, it } from "vitest";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";

/** W-13: locale key parity and placeholder parity between ar and en. */
function flatten(obj: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      for (const [k2, v2] of flatten(v, key)) out.set(k2, v2);
    } else {
      out.set(key, String(v));
    }
  }
  return out;
}

const PLACEHOLDER = /\{[a-zA-Z0-9]+\}/g;

describe("locale parity (W-13)", () => {
  const ar = flatten(arMessages);
  const en = flatten(enMessages);

  it("every en key exists in ar", () => {
    const missing = [...en.keys()].filter((k) => !ar.has(k));
    expect(missing, `missing in ar: ${missing.join(", ")}`).toEqual([]);
  });

  it("every ar key exists in en (no stray keys)", () => {
    const extra = [...ar.keys()].filter((k) => !en.has(k));
    expect(extra, `missing in en: ${extra.join(", ")}`).toEqual([]);
  });

  it("placeholders match exactly in both locales", () => {
    for (const [key, enValue] of en) {
      const arValue = ar.get(key);
      if (typeof arValue !== "string") continue;
      const enPlaceholders = [...enValue.matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
      const arPlaceholders = [...arValue.matchAll(PLACEHOLDER)].map((m) => m[0]).sort();
      expect(arPlaceholders, `placeholder mismatch for ${key}`).toEqual(enPlaceholders);
    }
  });

  it("both catalogs are non-trivial", () => {
    expect(ar.size).toBeGreaterThan(200);
    expect(en.size).toBe(ar.size);
  });
});
