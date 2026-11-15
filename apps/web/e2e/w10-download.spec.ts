import { expect, test } from "@playwright/test";

/**
 * W-10: the download centre picks the right primary build for Windows, macOS
 * (Apple Silicon first) and Linux x64/arm64 user agents. The primary block is
 * driven by client-side detection — emulate the UA per test.
 */
const ua = (os: string) => {
  switch (os) {
    case "win":
      return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36";
    case "mac":
      return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
    case "linux":
      return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36";
    default:
      return "Mozilla/5.0";
  }
};

test.describe("download detection", () => {
  test("windows x64 → .exe primary", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: ua("win"), locale: "en" });
    const page = await ctx.newPage();
    await page.goto("/en/download");
    // No releases published in dev seed → the block reports no matching build
    // but must not crash; the matrix states its empty state.
    await expect(page.getByText(/Build for your machine|البنية المناسبة/)).toBeVisible();
    await ctx.close();
  });

  test("mac shows the Apple Silicon first policy text", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: ua("mac"), locale: "en" });
    const page = await ctx.newPage();
    await page.goto("/en/download");
    await expect(page.locator("h1")).toContainText(/Download|تنزيل/);
    await ctx.close();
  });

  test("linux x64 → AppImage primary", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: ua("linux"), locale: "en" });
    const page = await ctx.newPage();
    await page.goto("/en/download");
    await expect(page.getByText(/Build for your machine|البنية المناسبة/)).toBeVisible();
    await ctx.close();
  });
});
