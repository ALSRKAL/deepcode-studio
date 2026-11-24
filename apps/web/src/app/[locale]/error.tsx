"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error("[web] route error", error);
  }, [error]);
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 px-4 text-center">
      <h1 className="text-display-sm font-semibold">{t("errorTitle")}</h1>
      <p className="text-[16px] leading-7 text-fg-muted">{t("errorBody")}</p>
      <button
        type="button"
        onClick={reset}
        className="mx-auto inline-flex h-11 items-center rounded-sm bg-primary px-5 text-[15px] font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t("retry")}
      </button>
    </main>
  );
}
