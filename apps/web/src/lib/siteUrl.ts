import { env } from "@/lib/env";

/** Public site origin used in metadata, robots and the sitemap.
 * APP_URL is only known at run time (the production build has no host settings), so
 * fall back to the public address instead of crashing a prerender. */
export const PUBLIC_SITE_FALLBACK = "https://deepcode-2sfl.onrender.com";

export function siteUrl(): string {
  const value = (env as { APP_URL?: string }).APP_URL ?? process.env.APP_URL ?? PUBLIC_SITE_FALLBACK;
  return value.replace(/\/$/, "");
}
