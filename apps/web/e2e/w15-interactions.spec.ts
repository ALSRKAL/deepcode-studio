import { expect, test } from "@playwright/test";

/**
 * W-15: mobile navigation, active states, skip link and locale switching are the
 * finish-line interactions that a screenshot cannot prove.
 */
test.use({ locale: "en" });
test.beforeEach(({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "en-desktop", "run once");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile menu opens, closes on Escape and restores focus", async ({ page }) => {
    await page.goto("/en");
    const trigger = page.getByRole("button", { name: "Menu" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Pricing" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("skip link is the first focus target and jumps to main", async ({ page }) => {
    await page.goto("/en/pricing");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("pricing CTA reaches sign-up", async ({ page }) => {
    await page.goto("/en/pricing");
    const cta = page.getByRole("link", { name: /Choose plan|Start free/ }).first();
    await expect(cta).toHaveAttribute("href", /\/sign-up$/);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the active nav item is marked for assistive tech", async ({ page }) => {
    await page.goto("/en/pricing");
    const link = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Pricing" });
    await expect(link).toHaveAttribute("aria-current", "page");
  });

  test("locale switch keeps the current page", async ({ page }) => {
    await page.goto("/en/pricing");
    await page.getByRole("banner").getByRole("button", { name: "ع" }).click();
    await expect(page).toHaveURL(/\/ar\/pricing$/);
  });
});
