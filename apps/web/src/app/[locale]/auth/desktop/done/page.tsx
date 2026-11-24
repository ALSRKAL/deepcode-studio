import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CopyButton } from "@/components/ui/client";
import { Card } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { noindexMetadata } from "@/lib/seo";

/**
 * Handoff after approval (docs/plan/03 §4.1 step 5): navigates to
 * deepcodestudio://auth?token=<one-time code>&state=<state> and shows a manual
 * fallback — the code is single-use, 60-second, and worthless without the
 * verifier that never leaves the desktop app.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "desktop" });
  return noindexMetadata({ locale, path: "/auth/desktop/done", title: t("doneTitle"), description: t("doneBody") });
}

export default async function DesktopAuthDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string; state?: string }>;
}) {
  const { locale } = await params;
  const { code, state } = await searchParams;
  const t = await getTranslations("desktop");

  if (!code || !state || !/^[A-Za-z0-9_-]{43,128}$/.test(code) || !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    redirect(`/${locale}/auth/desktop?error=invalid`);
  }

  const deepLink = `deepcodestudio://auth?token=${code}&state=${state}`;

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md place-content-center gap-6 px-4">
      <Card className="p-6">
        <h1 className="text-scale-md font-semibold">{t("doneTitle")}</h1>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">{t("doneBody")}</p>
        <div className="mt-4 grid gap-2 text-[13px] text-warning">
          <span>{t("expiresSoon")}</span>
        </div>
        <a
          href={deepLink}
          className="mt-4 inline-flex h-10 items-center rounded-sm bg-primary px-4 text-primary-fg font-medium hover:bg-primary-hover transition-colors duration-200 ease-out"
        >
          {t("openApp")}
        </a>
        <div className="mt-6 grid gap-2">
          <p className="text-[13px] text-fg-subtle">{t("copyCode")}</p>
          <div className="flex items-center gap-2">
            <LtrIsland className="block max-w-full overflow-x-auto rounded-sm border border-border bg-bg px-3 py-2 text-[12px] text-fg-muted">
              {deepLink}
            </LtrIsland>
            <CopyButton value={deepLink} label={t("copyCode")} />
          </div>
        </div>
      </Card>
    </main>
  );
}

// Per-user / token pages: never cached (see [locale]/layout.tsx).
export const dynamic = "force-dynamic";
