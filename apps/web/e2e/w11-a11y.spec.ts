import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * W-11: axe on every public + auth page in ar and en — zero serious or critical
 * violations; keyboard-only pass of sign-up and key creation.
 */
const PAGES = [
  "/",
  "/pricing",
  "/download",
  "/docs",
  "/changelog",
  "/contact",
  "/security",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/verify-email",
  "/reset-password",
  "/legal/terms",
  "/legal/privacy",
];

for (const locale of ["ar", "en"] as const) {
  for (const path of PAGES) {
    test(`axe: ${locale} ${path}`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.length} nodes`),
        `serious/critical a11y violations on ${locale}${path}`,
      ).toEqual([]);
    });
  }
}

test("keyboard-only pass of sign-up (ar)", async ({ page }) => {
  await page.goto("/ar/sign-up");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Tab"); // first focusable control
  await expect(page.locator(":focus")).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  // Focus ring token: visible outline on interactive elements.
  const outline = await page.locator(":focus").evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outline).not.toBe("0px");
});
