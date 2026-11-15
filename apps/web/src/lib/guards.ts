import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { auth, type SessionUser } from "./auth";
import { env } from "./env";
import { clientIpFromHeaders } from "./clientIp";

/**
 * Server-side authorisation (docs/plan/03 §4): every server component, action and
 * route handler calls these. Middleware never is the sole check.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session || session.user.status !== "active") return null;
  return session.user as SessionUser;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    const locale = await currentLocale();
    redirect(`/${locale}/sign-in`);
  }
  return user;
}

/** Admin layout guard: role check + mandatory 2FA (docs/plan/03 §6). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    // Not a 403 page — an anonymous-looking 404 does not confirm admin routes.
    notFound();
  }
  if (env.ADMIN_2FA_REQUIRED && !user.twoFactorEnabled) {
    const locale = await currentLocale();
    redirect(`/${locale}/dashboard/settings?twofa=required`);
  }
  return user;
}

/** Locale resolved by middleware (persisted choice or negotiation result). */
export async function currentLocale(): Promise<"ar" | "en"> {
  const h = await headers();
  return h.get("x-locale") === "en" ? "en" : "ar";
}

/** `path` under the current locale prefix: server actions redirect straight to the final URL. */
export async function localized(path: string): Promise<string> {
  return `/${await currentLocale()}${path === "/" ? "" : path}`;
}

/** Client IP behind a trusted proxy, else null (see lib/clientIp.ts). */
export async function clientIpOrNull(): Promise<string | null> {
  return clientIpFromHeaders(await headers(), { trustProxy: env.TRUST_PROXY, hops: env.TRUSTED_PROXY_HOPS });
}

/** Client IP for audit rows; "unknown" when no trusted proxy reports it. */
export async function clientIp(): Promise<string> {
  return (await clientIpOrNull()) ?? "unknown";
}
