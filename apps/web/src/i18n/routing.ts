import { defineRouting } from "next-intl/routing";

/**
 * Arabic is the default locale and RTL; English is LTR (docs/plan/04 Phase 2a).
 * The cookie persists an explicit choice; new visitors get their Accept-Language
 * match, falling back to Arabic.
 */
export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];
export const LOCALES = routing.locales;
export const isLocale = (v: string): v is Locale => v === "ar" || v === "en";
