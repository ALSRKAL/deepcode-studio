import { NextResponse, type NextRequest } from "next/server";

/**
 * Locale routing (docs/plan/03 §1.9) + security baseline (§7), without next-intl's
 * middleware so the CSP nonce can reach Next's script pipeline: pages live under
 * /[locale]/ with `ar` the default and RTL locale; the choice persists in a cookie.
 *
 * Security headers: CSP with a per-request nonce, frame-ancestors none, strict
 * referrer policy. HSTS is only effective once TLS terminates in front of the app.
 */
const LOCALES = ["ar", "en"] as const;
type Locale = (typeof LOCALES)[number];
const LOCALE_COOKIE = "NEXT_LOCALE";

function negotiate(request: NextRequest): Locale {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookie === "ar" || cookie === "en") return cookie;
  const header = request.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const tag = part.trim().split(";")[0]!.toLowerCase();
    if (tag === "ar" || tag.startsWith("ar-")) return "ar";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "ar"; // Arabic is the default locale (docs/plan/04 Phase 2a)
}

function withSecurityHeaders(request: NextRequest, locale: Locale): NextResponse {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-locale", locale);
  // Review L15: no 'unsafe-inline' and no bare https: in script-src — the nonce
  // plus strict-dynamic is the whole allowlist. Next reads the nonce back from
  // the request CSP header, so it must be set on both request and response.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return response;
}

/**
 * Same-origin redirect on the public origin. Behind the container proxy the
 * request URL is the internal `http://localhost:3000`, so a redirect built from
 * nextUrl sent visitors to localhost. The proxy passes the public host and scheme
 * (Host / X-Forwarded-Host / X-Forwarded-Proto); Next rejects relative Locations.
 */
function publicOrigin(request: NextRequest): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const proto = first(request.headers.get("x-forwarded-proto")) ?? request.nextUrl.protocol.replace(":", "");
  const host = first(request.headers.get("x-forwarded-host")) ?? request.headers.get("host") ?? request.nextUrl.host;
  const safeProto = proto === "https" || proto === "http" ? proto : "https";
  const safeHost = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host : request.nextUrl.host;
  return `${safeProto}://${safeHost}`;
}

function redirectTo(request: NextRequest, url: URL): NextResponse {
  return NextResponse.redirect(new URL(`${url.pathname}${url.search}`, publicOrigin(request)), 307);
}

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const seg = pathname.split("/")[1];
  if (seg === "ar" || seg === "en") {
    const response = withSecurityHeaders(request, seg);
    // Persist an explicit choice made via the locale switcher (?locale=en).
    const wanted = request.nextUrl.searchParams.get("locale");
    if ((wanted === "ar" || wanted === "en") && wanted !== seg) {
      const url = request.nextUrl.clone();
      url.searchParams.delete("locale");
      url.pathname = `/${wanted}${pathname.slice(seg.length + 1)}`;
      const redirect = redirectTo(request, url);
      redirect.cookies.set(LOCALE_COOKIE, wanted, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
      return redirect;
    }
    return response;
  }
  // Root or a prefix-less path: negotiate once, redirect permanently.
  const url = request.nextUrl.clone();
  url.pathname = `/${negotiate(request)}${pathname === "/" ? "" : pathname}`;
  const redirect = redirectTo(request, url);
  redirect.cookies.set(LOCALE_COOKIE, url.pathname.startsWith("/ar") ? "ar" : "en", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return redirect;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
