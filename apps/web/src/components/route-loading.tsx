"use client";

import { useTranslations } from "next-intl";

/** Loading boundary for the signed-in app only; public routes stay streaming-free so notFound() keeps its 404 status. */
export function RouteLoading() {
  const t = useTranslations("common");
  return (
    <div className="grid min-h-[50dvh] place-content-center gap-3" aria-busy="true" aria-live="polite">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden="true" />
      <p className="text-[14px] text-fg-muted">{t("loading")}</p>
    </div>
  );
}
