import { expect, test } from "@playwright/test";

/**
 * W-12: public pages × 2 locales × 3 widths. The screenshots are review
 * artifacts under test-results (never committed); layout invariants are asserted
 * so a screenshot cannot hide horizontal overflow or a missing title.
 */
const PAGES: Array<{ path: string; name: string; fullPage?: boolean }> = [
  { path: "/", name: "landing", fullPage: true },
  { path: "/pricing", name: "pricing" },
  { path: "/download", name: "download" },
  { path: "/docs", name: "docs" },
  { path: "/changelog", name: "changelog" },
  { path: "/contact", name: "contact" },
  { path: "/security", name: "security" },
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
  { path: "/legal/terms", name: "legal" },
];

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

test.use({ deviceScaleFactor: 1 });

for (const locale of ["ar", "en"] as const) {
  const dir = locale === "ar" ? "rtl" : "ltr";
  for (const width of WIDTHS) {
    // test.use at describe scope: a bare call in a for-loop would hoist and the
    // last viewport would win for every test in the file.
    test.describe(`visual ${locale} ${width.name}`, () => {
      test.use({ viewport: { width: width.width, height: width.height } });
      for (const target of PAGES) {
        test(`${target.name}`, async ({ page }) => {
          await page.goto(`/${locale}${target.path}`);
          await expect(page.locator(`html[lang="${locale}"][dir="${dir}"]`)).toHaveCount(1);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(150); // fonts settle
          await expect(page.locator("h1").first()).toBeVisible();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal overflow on ${locale}${target.path} at ${width.width}px`).toBeLessThanOrEqual(1);
          await page.screenshot({
            path: `test-results/visual/${target.name}-${locale}-${width.name}.png`,
            fullPage: target.fullPage,
            animations: "disabled",
            caret: "hide",
          });
        });
      }
    });
  }
}

test.describe("hero visual baseline", () => {
  for (const locale of ["ar", "en"] as const) {
    test(`hero ${locale}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== `${locale}-desktop`, `hero ${locale} runs once`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${locale}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      const hero = page.locator("main section").first();
      await expect(hero).toHaveScreenshot(`hero-${locale}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});

test.describe("bidi invariants", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("code blocks stay LTR in the Arabic shell", async ({ page }) => {
    await page.goto("/ar");
    const island = page.locator(".ltr-island").first();
    await expect(island).toBeVisible();
    const direction = await island.evaluate((el) => getComputedStyle(el).direction);
    expect(direction).toBe("ltr");
    const htmlDir = await page.locator("html").evaluate((el) => getComputedStyle(el).direction);
    expect(htmlDir).toBe("rtl");
  });

  test("the /en shell renders English copy", async ({ page }) => {
    await page.goto("/en/pricing");
    await expect(page.locator("h1")).toContainText(/plans|credits/i);
  });

  test("the /ar shell renders Arabic copy", async ({ page }) => {
    await page.goto("/ar/pricing");
    await expect(page.locator("h1")).toContainText("خطط");
  });
});
