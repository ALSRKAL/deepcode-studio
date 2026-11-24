import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * W-14: password recovery must work end-to-end. Sign up, verify through
 * Mailpit, request a reset, follow the emailed link, set a new password and sign
 * in with it. This is the regression guard for the missing /reset-password route.
 */
test.use({ locale: "ar" });
test.beforeEach(({ browserName: _browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "ar-desktop", "run once");
});

const MAIL_API = process.env.MAIL_API_URL ?? "http://127.0.0.1:55180";

async function mailTextFor(page: import("@playwright/test").Page, email: string): Promise<string> {
  for (let i = 0; i < 24; i += 1) {
    try {
      const res = await page.request.get(`${MAIL_API}/api/v1/messages?limit=30`);
      const data = (await res.json()) as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
      const message = data.messages.find((m) => m.To.some((to) => to.Address === email));
      if (message) {
        const detail = (await (await page.request.get(`${MAIL_API}/api/v1/message/${message.ID}`)).json()) as { Text: string };
        return detail.Text;
      }
    } catch {
      // Mailpit may not be up yet
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`no mail for ${email}`);
}

test("reset password: request → email → new password → sign in", async ({ page }) => {
  const email = `reset-${randomUUID().slice(0, 8)}@test.local`;
  const oldPassword = "correct horse battery";
  const newPassword = "a new stronger password";
  await page.goto("/ar/sign-up");
  await page.getByLabel(/الاسم|Name/).fill("Reset User");
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(email);
  await page.getByLabel(/كلمة المرور|Password/).first().fill(oldPassword);
  await page.getByLabel(/تأكيد كلمة المرور|Confirm password/).fill(oldPassword);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /إنشاء الحساب|Create account/ }).click();
  await expect(page).toHaveURL(/verify-email/);

  const verifyText = await mailTextFor(page, email);
  const verifyToken = /token=([^&\s]+)/.exec(verifyText)?.[1];
  expect(verifyToken).toBeTruthy();
  await page.goto(`/api/auth/verify-email?token=${verifyToken}`);
  await page.goto("/ar/sign-in");

  await page.getByLabel(/البريد الإلكتروني|Email/).fill(email);
  await page.getByLabel(/كلمة المرور|Password/).fill(oldPassword);
  await page.getByRole("button", { name: /دخول|Sign in/ }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Request a reset from inside the account.
  await page.goto("/ar/forgot-password");
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(email);
  await page.getByRole("button", { name: /إعادة تعيين|استعادة|Reset/ }).click();
  await expect(page).toHaveURL(/forgot-password\?sent=1/);
  const resetText = await mailTextFor(page, email);
  // better-auth sends /api/auth/reset-password/<token>?callbackURL=/reset-password;
  // accept either that form or a direct /reset-password?token=... link.
  const resetToken =
    /\/api\/auth\/reset-password\/([^?&\s]+)/.exec(resetText)?.[1] ??
    /reset-password\?token=([^&\s]+)/.exec(resetText)?.[1] ??
    /token=([^&\s]+)/.exec(resetText)?.[1];
  expect(resetToken, "reset mail must contain a token").toBeTruthy();

  await page.goto(`/ar/reset-password?token=${resetToken}`);
  await expect(page.getByRole("heading", { name: /اختر كلمة مرور جديدة|Choose a new password/ })).toBeVisible();
  await page.getByLabel(/كلمة المرور الجديدة|New password/).fill(newPassword);
  await page.getByLabel(/تأكيد كلمة المرور|Confirm password/).fill(newPassword);
  await page.getByRole("button", { name: /تعيين كلمة المرور|Set new password/ }).click();
  await expect(page).toHaveURL(/sign-in\?reset=1/);
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(email);
  await page.getByLabel(/كلمة المرور|Password/).fill(newPassword);
  await page.getByRole("button", { name: /دخول|Sign in/ }).click();
  await expect(page).toHaveURL(/dashboard/);
});
