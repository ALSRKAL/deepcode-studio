"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import QRCode from "qrcode";
import { auth } from "@/lib/auth";
import { applyAuthSetCookies } from "@/lib/authCookies";
import { currentLocale, requireUser, localized } from "@/lib/guards";
import { db } from "@/lib/db";
import { invalidateGateway } from "@/lib/gateway";
import { deleteUserAccount } from "@/lib/accountDeletion";
import { billingProvider } from "@/lib/billing";

export interface SettingsState {
  error?: string;
  ok?: boolean;
  totpUri?: string;
  /** QR code of totpUri (SVG from the qrcode library) for authenticator apps. */
  totpQrSvg?: string;
  /** Base32 secret for manual entry when the QR cannot be scanned. */
  totpSecret?: string;
}

/** Password is optional: accounts that have one must send it (enforced by better-auth). */
const OptionalPassword = z
  .string()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : undefined));

export async function updateProfileAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireUser();
  const name = z.string().trim().min(1).max(100).safeParse(formData.get("name"));
  const locale = z.enum(["ar", "en"]).safeParse(formData.get("locale"));
  if (!name.success) return { error: "invalid_input" };
  const h = await headers();
  try {
    await auth.api.updateUser({
      body: { name: name.data, ...(locale.success ? { locale: locale.data } : {}) },
      headers: h,
    });
  } catch {
    return { error: "invalid_input" };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function changePasswordAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireUser();
  const schema = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(200),
  });
  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) return { error: "weak_password" };
  const h = await headers();
  try {
    await auth.api.changePassword({
      body: { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword, revokeOtherSessions: true },
      headers: h,
    });
  } catch {
    return { error: "invalid_credentials" };
  }
  return { ok: true };
}

export async function enableTwoFactorAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireUser();
  const password = OptionalPassword.safeParse(formData.get("password"));
  if (!password.success) return { error: "invalid_input" };
  const h = await headers();
  try {
    const res = await auth.api.enableTwoFactor({ body: { password: password.data }, headers: h });
    const uri = (res as { totpURI?: string })?.totpURI;
    if (!uri) return { error: "invalid_input" };
    const totpQrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 200 });
    const totpSecret = new URL(uri).searchParams.get("secret") ?? undefined;
    return { totpUri: uri, totpQrSvg, totpSecret };
  } catch {
    return { error: "invalid_credentials" };
  }
}

export async function verifyTwoFactorAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireUser();
  const code = z.string().trim().min(6).max(10).safeParse(formData.get("code"));
  if (!code.success) return { error: "invalid_input" };
  const h = await headers();
  try {
    // Enabling 2FA replaces the session: forward the new session cookie explicitly.
    const res = await auth.api.verifyTOTP({ body: { code: code.data }, headers: h, returnHeaders: true });
    await applyAuthSetCookies(res.headers);
  } catch {
    return { error: "invalid_input" };
  }
  // A fresh request carries the NEW session cookie; re-rendering in this one would
  // still see the deleted session and bounce to sign-in.
  redirect(`/${await currentLocale()}/dashboard/settings?twofa=enabled`);
}

export async function disableTwoFactorAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireUser();
  const password = OptionalPassword.safeParse(formData.get("password"));
  if (!password.success) return { error: "invalid_input" };
  const h = await headers();
  try {
    const res = await auth.api.disableTwoFactor({ body: { password: password.data }, headers: h, returnHeaders: true });
    await applyAuthSetCookies(res.headers);
  } catch {
    return { error: "invalid_credentials" };
  }
  redirect(`/${await currentLocale()}/dashboard/settings?twofa=disabled`);
}

/**
 * Account deletion (docs/plan/03 §7): cancels paid subscriptions at the billing
 * provider first, then removes the user (cascades keys/devices/sessions/
 * subscriptions) and anonymises usage rows. See lib/accountDeletion.ts.
 */
export async function deleteAccountAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "DELETE") return { error: "invalid_input" };
  const result = await deleteUserAccount(db().db, user.id, {
    cancelProviderSubscription: async (sub) => {
      const provider = billingProvider();
      if (provider.id !== sub.billingProvider) {
        throw new Error(`subscription belongs to ${sub.billingProvider}, configured provider is ${provider.id}`);
      }
      await provider.cancel(sub.providerSubscriptionId, { atPeriodEnd: false });
    },
  });
  if (!result.ok) return { error: result.code };
  await invalidateGateway({ userIds: [user.id] });
  const h = await headers();
  await auth.api.signOut({ headers: h });
  redirect(await localized("/"));
}
