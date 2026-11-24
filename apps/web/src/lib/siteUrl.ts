import { env } from "./env";

/**
 * Canonical public origin used in metadata, robots, sitemap and social cards.
 *
 * Production must provide SITE_URL (or APP_URL) with the real https origin; the
 * fallback is only for the build step, where runtime env is intentionally absent.
 * Never point canonicals at localhost or a retired deployment host.
 */
export const PUBLIC_SITE_FALLBACK = "https://alsrkal.tail31ef3c.ts.net";

export function siteUrl(): string {
  const value =
    env.SITE_URL ??
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    env.APP_URL ??
    PUBLIC_SITE_FALLBACK;
  return value.replace(/\/+$/, "");
}
