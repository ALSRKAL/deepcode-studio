import { getTranslations } from "next-intl/server";
import { inArray } from "drizzle-orm";
import { SignedInSwitch } from "@/components/signed-in";
import { catalogModels, plans } from "@deepcode/db";
import { Card, Badge, Num } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { ButtonLink } from "@/components/ui/button";

type CatalogRow = Pick<typeof catalogModels.$inferSelect, "id" | "displayName" | "description" | "sortOrder">;

/** Plan names come from the catalog, so Go plans need no hard-coded model list here. */
function modelNames(ids: string[], byId: Map<string, CatalogRow>) {
  return ids
    .map((id) => byId.get(id))
    .filter((m): m is CatalogRow => Boolean(m))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({
      id: m.id,
      name: m.displayName,
      real: /\(([^)]+)\)\.?$/.exec(m.description ?? "")?.[1] ?? null,
    }));
}

/** Shared plan cards (docs/plan/03 §3.1): one source — the plans table. */
export async function PricingCards({
  plans: rows,
  locale,
  signedIn,
  compact = false,
}: {
  plans: Array<typeof plans.$inferSelect>;
  locale: string;
  /** Signed-in visitors pick a plan in billing; others start at sign-up. Undefined: decided in the browser. */
  signedIn?: boolean;
  /** Landing variant: no long model lists, just the plan facts. */
  compact?: boolean;
}) {
  const t = await getTranslations({ locale: locale as "ar" | "en", namespace: "pricing" });
  const allModelIds = [...new Set(rows.flatMap((p) => p.allowedModels))];
  const catalogRows =
    !compact && allModelIds.length
      ? await db()
          .db.select({
            id: catalogModels.id,
            displayName: catalogModels.displayName,
            description: catalogModels.description,
            sortOrder: catalogModels.sortOrder,
          })
          .from(catalogModels)
          .where(inArray(catalogModels.id, allModelIds))
      : [];
  const catalogById = new Map(catalogRows.map((m) => [m.id, m]));
  const proIndex = rows.findIndex((p) => p.tier === "pro");
  const featured = proIndex >= 0 ? proIndex : Math.floor((rows.length - 1) / 2) + (rows.length % 2 === 0 ? 1 : 0);
  const cols =
    rows.length <= 1
      ? "lg:grid-cols-1"
      : rows.length === 2
        ? "lg:grid-cols-2"
        : rows.length === 3
          ? "lg:grid-cols-3"
          : "lg:grid-cols-4";
  if (rows.length === 0) {
    return <p className="text-[15px] text-fg-muted">{t("empty")}</p>;
  }
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${cols}`}>
      {rows.map((plan, i) => {
        const modelList = compact ? [] : modelNames(plan.allowedModels, catalogById);
        const shown = modelList.slice(0, 3);
        const more = modelList.length - shown.length;
        const billing = `/${locale}/dashboard/billing`;
        const signUp = `/${locale}/sign-up`;
        const cta = (href: string) => (
          <ButtonLink href={href} variant={i === featured ? "primary" : "secondary"} size="md" className="mt-auto w-full">
            {plan.priceCents === 0 ? t("startFree") : t("choose")}
          </ButtonLink>
        );
        return (
          <Card key={plan.id} className="flex h-full flex-col gap-4 p-5" accent={i === featured}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{locale === "ar" ? plan.nameAr : plan.nameEn}</p>
              {i === featured ? <Badge tone="primary">{t("recommended")}</Badge> : null}
            </div>
            <p className="flex items-baseline gap-1.5">
              <Num className="text-scale-xl font-semibold">{formatPrice(plan.priceCents, plan.currency)}</Num>
              <span className="text-[13px] text-fg-muted">{plan.interval === "year" ? t("perYear") : t("perMonth")}</span>
            </p>
            <p className="text-[13px] text-fg-muted">
              <Num className="font-medium text-fg">{plan.creditsPerPeriod.toLocaleString("en-US")}</Num> {t("credits")}
            </p>
            <ul className="grid gap-1.5 text-[13px] text-fg-muted">
              <li>{t("rpmCount", { count: plan.rpmLimit })}</li>
              <li>{t("concurrencyCount", { count: plan.maxConcurrentStreams })}</li>
              <li>{t("devicesCount", { count: plan.maxDevices })}</li>
              <li>{t("modelsCount", { count: plan.allowedModels.length })}</li>
            </ul>
            {!compact ? (
              <div className="border-t border-border pt-3">
                <ul className="grid gap-1 text-[13px]" data-testid="plan-models">
                  {shown.map((m) => (
                    <li key={m.id} className="flex items-baseline justify-between gap-2">
                      <bdi dir="ltr">{m.name}</bdi>
                      {m.real ? <bdi dir="ltr" className="truncate text-[12px] text-fg-subtle">{m.real}</bdi> : null}
                    </li>
                  ))}
                </ul>
                {more > 0 ? <p className="mt-2 text-[12px] text-fg-subtle">{t("modelsMore", { count: more })}</p> : null}
              </div>
            ) : null}
            {signedIn === undefined ? <SignedInSwitch signedIn={cta(billing)} signedOut={cta(signUp)} /> : signedIn ? cta(billing) : cta(signUp)}
          </Card>
        );
      })}
    </div>
  );
}
