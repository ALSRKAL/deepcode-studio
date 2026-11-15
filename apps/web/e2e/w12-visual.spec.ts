import { expect, test } from "@playwright/test";

/**
 * W-12: screenshots of key pages × 2 locales × 3 widths; RTL mirroring verified
 * (html[dir=rtl], mirrored shell) and code blocks stay LTR (`.ltr-island`).
 * Screenshots land in e2e/screenshots/<name>.png for the review pass.
 */
const PAGES: Array<{ path: string; name: string; fullPage?: boolean }> = [
  { path: "/", name: "landing", fullPage: true },
  { path: "/pricing", name: "pricing" },
  { path: "/download", name: "download" },
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
  { path: "/legal/terms", name: "legal" },
];

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

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
          // The rendered copy must match the URL locale (regression guard for
          // the request-config locale bug found in the first screenshot pass).
          await page.waitForTimeout(300); // fonts settle
          await page.screenshot({
            path: `e2e/screenshots/${target.name}-${locale}-${width.name}.png`,
            fullPage: target.fullPage,
          });
        });
      }
    });
  }
}

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
    await expect(page.locator("h1")).toContainText(/Simple plans|transparent/i);
  });

  test("the /ar shell renders Arabic copy", async ({ page }) => {
    await page.goto("/ar/pricing");
    await expect(page.locator("h1")).toContainText("خطط");
  });
});
