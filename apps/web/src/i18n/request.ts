import { getRequestConfig } from "next-intl/server";
import { routing, type Locale } from "./routing";
import { cookies, headers } from "next/headers";
import arMessages from "./messages/ar.json";
import enMessages from "./messages/en.json";

const MESSAGES: Record<Locale, Record<string, unknown>> = { ar: arMessages, en: enMessages };

export default getRequestConfig(async () => {
  // The URL segment is authoritative: middleware stamps x-locale on every
  // /[locale]/ request. The cookie only breaks ties for prefix-less paths.
  const h = await headers();
  const headerLocale = h.get("x-locale");
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale: Locale =
    headerLocale === "ar" || headerLocale === "en"
      ? headerLocale
      : cookieLocale === "en" || cookieLocale === "ar"
        ? cookieLocale
        : routing.defaultLocale;
  return {
    locale,
    messages: MESSAGES[locale],
  };
});
