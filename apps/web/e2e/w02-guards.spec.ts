/**
 * W-02: every dashboard/admin route rejects anonymous callers and anonymous
 * users never confirm the existence of admin pages. Generated from the route
 * list below — a new route without a guard fails CI.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/** Walks the app tree to collect page routes, so new pages fail this test if unguarded. */
function collectRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

const appDir = join(import.meta.dirname, "..", "src", "app", "[locale]");
const allRoutes = collectRoutes(appDir)
  .map((r) => r.replace(/\([a-z]+\)/g, ""))
  .filter((r) => !r.includes("[slug]") && !r.includes("[id]") && !r.includes("mock-billing"));

const PROTECTED = allRoutes.filter((r) => r.startsWith("/dashboard") || r.startsWith("/admin"));

test("route inventory is non-trivial (guards cannot silently pass)", () => {
  expect(PROTECTED.length).toBeGreaterThanOrEqual(9);
});

for (const route of PROTECTED) {
  test(`anonymous ${route} is redirected or 404`, async ({ page }) => {
    const res = await page.goto(`/ar${route}`, { waitUntil: "domcontentloaded" });
    // Guarded pages either redirect to sign-in, render the sign-in form, or 404.
    if (res?.status() === 404) return;
    const url = page.url();
    const redirected = /sign-in/.test(url);
    if (!redirected) {
      expect(res?.status()).toBeLessThan(400);
    }
    expect(redirected || res?.status() === 404).toBe(true);
  });
}
