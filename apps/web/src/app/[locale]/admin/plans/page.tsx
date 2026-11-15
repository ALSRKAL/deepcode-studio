import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { catalogModels, plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Badge, Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { LocaleLink } from "@/components/locale-link";
import { PlanForm } from "@/components/models-admin-client";
import { formatPrice } from "@/lib/money";

/**
 * Plans (docs/plan/03 §6.3, owner request 2026-11-15): every plan field is
 * editable here; which models a plan offers is managed on /admin/models.
 */
export default async function AdminPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireAdmin();
  const t = await getTranslations("adminModels");
  const ta = await getTranslations("admin");

  const planRows = await db().db.select().from(plans).orderBy(asc(plans.sortOrder));
  const models = await db().db.select({ id: catalogModels.id, name: catalogModels.displayName, status: catalogModels.status, isFree: catalogModels.isFree }).from(catalogModels);
  const byId = new Map(models.map((m) => [m.id, m]));

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{ta("plans")}</h1>
      {planRows.map((plan) => (
        <Card key={plan.id} className="grid gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{locale === "ar" ? plan.nameAr : plan.nameEn}</p>
            <LtrIsland className="font-mono text-[12px] text-fg-subtle">{plan.id}</LtrIsland>
            <Badge tone="primary">{plan.tier}</Badge>
            <Num className="text-[13px] text-fg-muted">{formatPrice(plan.priceCents, plan.currency)}</Num>
            {!plan.isPublic ? <Badge tone="neutral">private</Badge> : null}
          </div>
          <PlanForm
            plan={{
              id: plan.id,
              nameEn: plan.nameEn,
              nameAr: plan.nameAr,
              priceCents: plan.priceCents,
              currency: plan.currency,
              creditsPerPeriod: plan.creditsPerPeriod,
              rpmLimit: plan.rpmLimit,
              maxConcurrentStreams: plan.maxConcurrentStreams,
              maxKeys: plan.maxKeys,
              maxDevices: plan.maxDevices,
              maxOutputTokens: plan.maxOutputTokens,
              isPublic: plan.isPublic,
              sortOrder: plan.sortOrder,
              fallbackEnabled: plan.fallbackEnabled,
            }}
          />
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] font-medium">
                {t("planModels")}: <Num>{plan.allowedModels.length}</Num>
              </p>
              <LocaleLink locale={locale} href="/admin/models" className="text-[13px] text-primary underline-offset-4 hover:underline">
                {t("manageModels")}
              </LocaleLink>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.allowedModels.map((id) => {
                const m = byId.get(id);
                const unavailable = m ? m.status !== "active" : false;
                return (
                  <span
                    key={id}
                    className={`rounded-sm border px-2 py-0.5 text-[12px] ${unavailable ? "border-danger/40 text-danger line-through" : "border-border text-fg-muted"}`}
                    title={unavailable ? m?.status : undefined}
                  >
                    {m?.name ?? id}
                    {m?.isFree ? " · " + t("free") : ""}
                  </span>
                );
              })}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
