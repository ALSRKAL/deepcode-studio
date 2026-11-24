"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { users } from "@deepcode/db";
import { auth } from "@/lib/auth";
import { applyAuthSetCookies } from "@/lib/authCookies";
import { currentUser, clientIpOrNull, currentLocale, localized } from "@/lib/guards";
import { limiterKey } from "@/lib/clientIp";
import { db } from "@/lib/db";
import { createDesktopAuthCode } from "@/lib/desktopAuth";
import { rateLimit } from "@/lib/rateLimit";
import { googleSignInEnabled } from "@/lib/oauth";

/**
 * Auth form actions wrapping better-auth's server API (docs/plan/03 §4). Cookies
 * are set by better-auth through next/headers (nextCookies plugin). Errors are
 * generic: no account enumeration (W-01).
 */
export interface AuthState {
  error?:
    | "invalid_credentials"
    | "email_taken"
    | "unverified"
    | "invalid_input"
    | "weak_password"
    | "rate_limited"
    | "invalid_code"
    | "expired_challenge"
    | "invalid_token"
    | "password_mismatch"
    | "consent_required";
}

/**
 * Better Auth's limiter runs only in its HTTP handler, not on direct `auth.api.*`
 * calls (review M2) — every server action that touches credentials is rate
 * limited here, keyed by client IP and, where applicable, the target email.
 */
async function authRateLimit(scope: string, extra: string, limit: number): Promise<AuthState | null> {
  // Per target always; per IP only when a trusted proxy reports it (review: a
  // spoofable header must not choose the bucket). Without one, a high shared
  // ceiling bounds load without letting one client lock everyone out.
  const bucket = limiterKey(await clientIpOrNull());
  const byIp = await rateLimit(`auth:${scope}:${bucket.key}`, bucket.shared ? limit * 30 : limit, 60);
  const byTarget = await rateLimit(`auth:${scope}:target:${extra.toLowerCase()}`, limit, 60);
  return byIp.allowed && byTarget.allowed ? null : { error: "rate_limited" };
}

const CredentialsSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200),
});

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = CredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid_input" };
  const limited = await authRateLimit("signin", parsed.data.email, 10);
  if (limited) return limited;
  const h = await headers();
  let twoFactor = false;
  try {
    const res = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: h,
    });
    // With 2FA on, better-auth answers with a challenge (2FA cookie set) instead of a session.
    twoFactor = (res as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect === true;
  } catch (err) {
    if (isRedirect(err)) throw err;
    const code = (err as { code?: string; message?: string })?.code ?? (err as Error).message;
    if (code === "EMAIL_NOT_VERIFIED") return { error: "unverified" };
    return { error: "invalid_credentials" };
  }
  const returnTo = safeReturnTo(formData.get("returnTo"));
  if (twoFactor) {
    const locale = await currentLocale();
    redirect(`/${locale}/sign-in/two-factor${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
  }
  redirect(returnTo ?? (await localized("/dashboard")));
}

/** Second step of a password sign-in for accounts with 2FA: authenticator code or a backup code. */
export async function verifySignInTwoFactorAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const raw = String(formData.get("code") ?? "").replace(/\s+/g, "");
  const isTotp = /^\d{6}$/.test(raw);
  if (!isTotp && !/^[A-Za-z0-9-]{8,32}$/.test(raw)) return { error: "invalid_code" };
  const h = await headers();
  // Per pending challenge (the signed 2FA cookie); better-auth also caps attempts per challenge.
  const challenge = /two_factor=([^;]+)/.exec(h.get("cookie") ?? "")?.[1];
  if (!challenge) return { error: "expired_challenge" };
  const limited = await authRateLimit("signin-2fa", challenge.slice(0, 64), 10);
  if (limited) return limited;
  const trustDevice = formData.get("trustDevice") === "on";
  try {
    // The 2FA step creates the session: forward its cookie explicitly.
    const res = isTotp
      ? await auth.api.verifyTOTP({ body: { code: raw, trustDevice }, headers: h, returnHeaders: true })
      : await auth.api.verifyBackupCode({ body: { code: raw, trustDevice }, headers: h, returnHeaders: true });
    await applyAuthSetCookies(res.headers);
  } catch (err) {
    if (isRedirect(err)) throw err;
    return { error: "invalid_code" };
  }
  redirect(safeReturnTo(formData.get("returnTo")) ?? (await localized("/dashboard")));
}

// returnTo is a same-app path only (no protocol, no authority, no "//") — no
// open redirect. Desktop consent paths legitimately carry a query string.
function safeReturnTo(value: FormDataEntryValue | null): string | null {
  const returnTo = String(value ?? "");
  return /^\/(ar|en)\/[a-z0-9/_-]+(\?[A-Za-z0-9_=&%+.*-]+)?$/.test(returnTo) && !returnTo.includes("//")
    ? returnTo
    : null;
}

/** "Continue with Google": sign-in and sign-up in one (Google verifies the email). */
export async function googleSignInAction(formData: FormData): Promise<void> {
  const locale = z.enum(["ar", "en"]).catch("ar").parse(formData.get("locale"));
  if (!googleSignInEnabled()) redirect(`/${locale}/sign-in?error=oauth`);
  const res = await auth.api.signInSocial({
    body: {
      provider: "google",
      callbackURL: safeReturnTo(formData.get("returnTo")) ?? `/${locale}/dashboard`,
      errorCallbackURL: `/${locale}/sign-in?error=oauth`,
      newUserCallbackURL: `/${locale}/dashboard`,
    },
    headers: await headers(),
  });
  if (!res?.url) redirect(`/${locale}/sign-in?error=oauth`);
  redirect(res.url);
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const schema = CredentialsSchema.extend({
    name: z.string().trim().min(1).max(100),
    confirmPassword: z.string().min(10).max(200),
    acceptTerms: z.literal("on"),
  });
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    acceptTerms: formData.get("acceptTerms"),
  });
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.acceptTerms) return { error: "consent_required" };
    if (fields.password) return { error: "weak_password" };
    if (fields.confirmPassword) return { error: "password_mismatch" };
    return { error: "invalid_input" };
  }
  if (parsed.data.password !== parsed.data.confirmPassword) return { error: "password_mismatch" };
  const locale = z.enum(["ar", "en"]).catch("ar").parse(formData.get("locale"));
  const signupLimited = await authRateLimit("signup", parsed.data.email, 5);
  if (signupLimited) return signupLimited;
  const h = await headers();
  try {
    await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: h,
    });
    // Persist the UI locale on the user row (locale is an additional field,
    // not part of better-auth's body contract).
    await db().db
      .update(users)
      .set({ locale, updatedAt: new Date() })
      .where(sql`lower(${users.email}) = ${parsed.data.email.toLowerCase()}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    const body = err as { code?: string; message?: string };
    if (body?.code === "USER_ALREADY_EXISTS" || body.message?.includes("already")) return { error: "email_taken" };
    return { error: "invalid_input" };
  }
  redirect(await localized("/verify-email?sent=1"));
}

export async function signOutAction(): Promise<void> {
  const h = await headers();
  await auth.api.signOut({ headers: h });
  redirect(await localized("/"));
}

export async function requestPasswordResetAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().email().max(200).safeParse(formData.get("email"));
  // Always "sent": no account enumeration (W-01). The action is rate limited by
  // IP and target before asking better-auth to send anything, bounding mail-bombing.
  if (!email.success) return {};
  const resetLimited = await authRateLimit("reset", email.data, 5);
  if (resetLimited) return resetLimited;
  const h = await headers();
  try {
    await auth.api.requestPasswordReset({ body: { email: email.data, redirectTo: "/reset-password" }, headers: h });
  } catch (err) {
    if (isRedirect(err)) throw err;
    // swallowed: the response is identical either way
  }
  redirect(await localized("/forgot-password?sent=1"));
}

/** Completes a password reset from the emailed token (better-auth resetPassword). */
export async function resetPasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const schema = z
    .object({
      token: z.string().min(16).max(512),
      password: z.string().min(10).max(200),
      confirmPassword: z.string().min(10).max(200),
    })
    .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"] });
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors.confirmPassword ? "password_mismatch" : "invalid_input" };
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const limited = await authRateLimit("reset-confirm", tokenHash, 10);
  if (limited) return limited;
  try {
    await auth.api.resetPassword({
      body: { newPassword: parsed.data.password, token: parsed.data.token },
      headers: await headers(),
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    return { error: "invalid_token" };
  }
  redirect(await localized("/sign-in?reset=1"));
}

/** Resends the verification mail for an unverified address (enumeration-safe). */
export async function resendVerificationAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().email().max(200).safeParse(formData.get("email"));
  if (!email.success) return { error: "invalid_input" };
  const limited = await authRateLimit("verify", email.data, 3);
  if (limited) return limited;
  try {
    await auth.api.sendVerificationEmail({
      body: { email: email.data, callbackURL: `/${await currentLocale()}/sign-in` },
      headers: await headers(),
    });
  } catch (err) {
    if (isRedirect(err)) throw err;
    // Same response for unknown accounts: no enumeration.
  }
  redirect(await localized("/verify-email?sent=1"));
}

/** The desktop consent screen approval (docs/plan/03 §4.1 step 4). */
export async function approveDesktopAuthAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect(await localized("/sign-in"));
  const schema = z.object({
    state: z.string().min(16).max(128),
    code_challenge: z.string().min(43).max(128),
    device_name: z.string().min(1).max(100),
    os: z.string().min(1).max(50),
    app_version: z.string().max(50).optional().or(z.literal("")),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(await localized("/auth/desktop?error=invalid"));
  const { code } = await createDesktopAuthCode(db().db, user!.id, {
    state: parsed.data.state,
    codeChallenge: parsed.data.code_challenge,
    deviceName: parsed.data.device_name,
    os: parsed.data.os,
    appVersion: parsed.data.app_version || undefined,
  });
  redirect(await localized(`/auth/desktop/done?code=${encodeURIComponent(code)}&state=${encodeURIComponent(parsed.data.state)}`));
}

/** redirect() throws NEXT_REDIRECT — never swallow it in the try blocks above. */
function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT");
}
