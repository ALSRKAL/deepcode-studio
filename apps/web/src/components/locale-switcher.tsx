"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Language switch: persists via NEXT_LOCALE, keeps the current path. */
export function LocaleSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  const setLocale = (next: "ar" | "en") => {
    if (next === locale) return;
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; samesite=lax`;
    start(() => {
      router.push(`${window.location.pathname.replace(/^\/(ar|en)/, `/${next}`)}${window.location.search}`);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center rounded-sm border border-border" role="group" aria-label={t("language")}>
      <button
        type="button"
        onClick={() => setLocale("ar")}
        disabled={pending}
        aria-pressed={locale === "ar"}
        aria-label="ع"
        title="العربية"
        className={`h-11 px-3 text-[13px] rounded-s-sm transition-colors duration-200 ease-out ${
          locale === "ar" ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg"
        }`}
      >
        ع
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        disabled={pending}
        aria-pressed={locale === "en"}
        aria-label="EN"
        title="English"
        className={`h-11 px-3 text-[13px] rounded-e-sm transition-colors duration-200 ease-out ${
          locale === "en" ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg"
        }`}
      >
        EN
      </button>
    </div>
  );
}
