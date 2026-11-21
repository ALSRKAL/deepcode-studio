import { getRequestConfig } from "next-intl/server";
import { routing, type Locale } from "./routing";
import { cookies, headers } from "next/headers";
import arMessages from "./messages/ar.json";
import enMessages from "./messages/en.json";

const MESSAGES: Record<Locale, Record<string, unknown>> = { ar: arMessages, en: enMessages };

function isLocale(value: string | undefined | null): value is Locale {
  return value === "ar" || value === "en";
}

export default getRequestConfig(async ({ requestLocale }) => {
  // The URL segment is authoritative. Pages under /[locale]/ declare it with
  // setRequestLocale, so reading it here touches no request headers and those
  // pages can be cached (2026-11-21: reading headers()/cookies() on every call made
  // every page dynamic; the homepage served 11 req/s with 10 s latency under load).
  const segmentLocale = await requestLocale;
  if (isLocale(segmentLocale)) return { locale: segmentLocale, messages: MESSAGES[segmentLocale] };
  // Prefix-less paths: middleware stamps x-locale; the cookie breaks ties.
  const h = await headers();
  const headerLocale = h.get("x-locale");
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale: Locale = isLocale(headerLocale)
    ? headerLocale
    : isLocale(cookieLocale)
      ? cookieLocale
      : routing.defaultLocale;
  return {
    locale,
    messages: MESSAGES[locale],
  };
});
