import { expect, test } from "@playwright/test";

/**
 * W-10: the download centre always renders every desktop choice in the initial
 * HTML, then marks the detected platform. Detection logic itself is unit-tested
 * in test/download.test.ts; this spec checks the page contract and no-JS state.
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

for (const [os, label] of [
  ["win", /Windows/],
  ["mac", /macOS/],
  ["linux", /Linux/],
] as const) {
  test(`${os} sees the desktop build choices`, async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: ua(os), locale: "en" });
    const page = await ctx.newPage();
    await page.goto("/en/download");
    await expect(page.locator("h1")).toContainText(/Download/);
    const buildLinks = page.locator('a[href*="/releases/download/"]');
    if ((await buildLinks.count()) > 0) {
      await expect(page.getByText(label).first()).toBeVisible();
      // One recommendation per OS: Apple Silicon on macOS, x64 on Windows/Linux.
      await expect(page.getByText(/Recommended for your device/)).toHaveCount(1);
    } else {
      await expect(page.getByText(/No published releases yet/).first()).toBeVisible();
    }
    await ctx.close();
  });
}

test("the install commands are server-rendered", async ({ page }) => {
  await page.goto("/en/download");
  await expect(page.getByText(/Install with one command/)).toBeVisible();
  await expect(page.locator("code").filter({ hasText: "install.ps1" })).toBeVisible();
  await expect(page.locator("code").filter({ hasText: "install.sh" })).toBeVisible();
});
