import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * W-09: landing → pricing → sign-up → test-mode checkout → dashboard shows the
 * active plan. Runs in the ar-desktop project by default; the flow is locale
 * independent (selectors use test ids / roles, not translated copy).
 */
test.use({ locale: "ar" });

test("sign-up, mock checkout, dashboard shows the active plan", async ({ page }) => {
  const email = `e2e-${randomUUID().slice(0, 8)}@test.local`;

  await page.goto("/ar");
  await expect(page).toHaveTitle(/DeepCode Studio/);
  await page.goto("/ar/pricing");

  await page.goto("/ar/sign-up");
  await page.getByLabel(/الاسم|Name/).fill("E2E User");
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(email);
  await page.getByLabel(/كلمة المرور|Password/).last().fill("correct horse battery");
  await page.getByRole("button", { name: /إنشاء الحساب|Create account/ }).click();
  await expect(page).toHaveURL(/verify-email/);

  // Verify through Mailpit (local catcher): the token arrives in the mail.
  const mailApi = process.env.MAIL_API_URL ?? "http://127.0.0.1:55180";
  let token: string | null = null;
  for (let i = 0; i < 20 && !token; i += 1) {
    try {
      const res = await page.request.get(`${mailApi}/api/v1/messages?limit=20`);
      const data = (await res.json()) as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
      const message = data.messages.find((m) => m.To.some((t) => t.Address === email));
      if (message) {
        const detail = (await (await page.request.get(`${mailApi}/api/v1/message/${message.ID}`)).json()) as { Text: string };
        token = /token=([^&\s]+)/.exec(detail.Text)?.[1] ?? null;
      }
    } catch {
      // Mailpit not running — retried below
    }
    await page.waitForTimeout(250);
  }
  expect(token, "verification mail must arrive via Mailpit").toBeTruthy();
  await page.goto(`/ar/sign-in`);
  await page.goto(`/api/auth/verify-email?token=${token}`);

  await page.goto("/ar/sign-in");
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(email);
  await page.getByLabel(/كلمة المرور|Password/).last().fill("correct horse battery");
  await page.getByRole("button", { name: /دخول|Sign in/ }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Mock checkout: choose the paid starter plan, pay, return to the dashboard.
  await page.goto("/ar/dashboard/billing");
  const choose = page.getByRole("button", { name: /اختيار الخطة|Choose plan/ }).first();
  await choose.click();
  await expect(page).toHaveURL(/mock-billing/);
  await page.getByRole("button", { name: /ادفع|Pay/ }).click();
  await expect(page).toHaveURL(/dashboard\/billing/);
  await expect(page.getByText(/starter|المبتدئ/).first()).toBeVisible();
});
