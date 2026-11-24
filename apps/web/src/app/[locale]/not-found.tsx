"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

export default function NotFound() {
  const locale = useLocale();
  const t = useTranslations("common");
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-3xl place-content-center gap-4 px-4 text-center">
      <p className="text-scale-3xl font-semibold tabular text-primary">404</p>
      <h1 className="text-display-sm font-semibold">{t("notFoundTitle")}</h1>
      <p className="mx-auto max-w-md text-[16px] leading-7 text-fg-muted">{t("notFoundBody")}</p>
      <div className="mt-2 flex justify-center">
        <Link
          href={`/${locale}`}
          className="inline-flex min-h-11 items-center rounded-sm bg-primary px-5 text-[15px] font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
