import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { listProvidersForAdmin } from "@/lib/modelAdmin";
import { Badge, Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { LocaleLink } from "@/components/locale-link";
import { ProviderForm, SyncProviderButton, type ProviderFormValue } from "@/components/models-admin-client";

/** Providers and model sync (owner request 2026-11-15). */
export default async function AdminProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireAdmin();
  const t = await getTranslations("adminModels");
  const providers = await listProvidersForAdmin(db().db);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-scale-lg font-semibold">{t("providersTitle")}</h1>
        <p className="text-[13px] leading-6 text-fg-muted">{t("providersIntro")}</p>
      </div>

      <div className="grid gap-4">
        {providers.map((p) => {
          const value: ProviderFormValue = {
            id: p.id,
            displayName: p.displayName,
            baseUrls: p.baseUrls,
            catalogFormat: p.catalogFormat,
            modelsUrl: p.modelsUrl,
            hideModelPattern: p.hideModelPattern,
            sessionHeader: p.sessionHeader,
            enabled: p.enabled,
            isFallback: p.isFallback,
            priority: p.priority,
          };
          return (
            <Card key={p.id} className="grid gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{p.displayName}</p>
                    <LtrIsland className="font-mono text-[12px] text-fg-subtle">{p.id}</LtrIsland>
                    <Badge tone={p.enabled ? "success" : "neutral"}>{p.enabled ? t("enabled") : "off"}</Badge>
                    {p.isFallback ? <Badge tone="warning">{t("fallback")}</Badge> : null}
                  </div>
                  <p className="text-[13px] text-fg-muted">
                    {t("keys")}: <Num>{p.activeKeys}</Num>/<Num>{p.totalKeys}</Num> ·{" "}
                    <LocaleLink locale={locale} href={`/admin/models?provider=${p.id}`} className="underline-offset-4 hover:underline">
                      {t("models")}: <Num>{p.routedModels}</Num>
                    </LocaleLink>{" "}
                    · {t("lastSync")}: <Num>{p.lastSyncedAt ? p.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ") : t("never")}</Num>
                  </p>
                  {p.enabled && p.activeKeys === 0 ? (
                    <p role="alert" className="text-[13px] text-danger">
                      {t("noKeysWarning")}
                    </p>
                  ) : null}
                </div>
                {p.catalogFormat !== "manual" && p.modelsUrl ? <SyncProviderButton providerId={p.id} /> : null}
              </div>
              <details>
                <summary className="cursor-pointer text-[13px] text-fg-muted">{t("addProvider")}</summary>
                <div className="mt-3">
                  <ProviderForm initial={value} />
                </div>
              </details>
            </Card>
          );
        })}
      </div>

      <Card className="grid gap-3 p-5">
        <h2 className="font-semibold">{t("addProvider")}</h2>
        <ProviderForm />
      </Card>
    </div>
  );
}
