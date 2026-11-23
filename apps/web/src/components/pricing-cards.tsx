import { getTranslations } from "next-intl/server";
import { inArray } from "drizzle-orm";
import { SignedInSwitch } from "@/components/signed-in";
import { catalogModels, plans } from "@deepcode/db";
import { Card, Badge, Num } from "@/components/ui/primitives";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { ButtonLink } from "@/components/ui/button";

type CatalogRow = Pick<
  typeof catalogModels.$inferSelect,
  "id" | "displayName" | "description" | "sortOrder"
>;

/** Plan names come from the catalog, so Go plans need no hard-coded model list here. */
function modelNames(
  ids: string[],
  byId: Map<string, CatalogRow>,
): Array<{ id: string; name: string; real: string | null }> {
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
}: {
  plans: Array<typeof plans.$inferSelect>;
  locale: string;
  /** Signed-in visitors pick a plan in billing; others start at sign-up. Undefined: decided in the browser. */
  signedIn?: boolean;
}) {
  const t = await getTranslations({ locale: locale as "ar" | "en", namespace: "pricing" });
  const allModelIds = [...new Set(rows.flatMap((p) => p.allowedModels))];
  const catalogRows = allModelIds.length
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
  // Highlight Pro whenever it is public; with Free added, "the middle" would be Starter.
  const proIndex = rows.findIndex((p) => p.tier === "pro");
  const featured = proIndex >= 0 ? proIndex : Math.floor((rows.length - 1) / 2) + (rows.length % 2 === 0 ? 1 : 0);
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${rows.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
      {rows.map((plan, i) => (
        <Card key={plan.id} className="p-5 flex flex-col gap-3" accent={i === featured}>
          <div className="flex items-center justify-between">
            <p className="font-semibold">{locale === "ar" ? plan.nameAr : plan.nameEn}</p>
            {i === featured ? <Badge tone="primary">{t("recommended")}</Badge> : null}
          </div>
          <p className="flex items-baseline gap-1.5">
            <Num className="text-scale-lg">{formatPrice(plan.priceCents, plan.currency)}</Num>
            <span className="text-fg-muted text-[13px]">{plan.interval === "year" ? t("perYear") : t("perMonth")}</span>
          </p>
          <p className="flex items-baseline gap-1.5 text-[13px] text-fg-muted">
            <Num>{plan.creditsPerPeriod.toLocaleString("en-US")}</Num>
            <span>{t("credits")}</span>
          </p>
          <ul className="grid gap-1.5 text-[13px] text-fg-muted">
            <li className="flex items-baseline gap-1.5">
              <Num>{plan.rpmLimit}</Num>
              <span>{t("rpm")}</span>
            </li>
            <li className="flex items-baseline gap-1.5">
              <Num>{plan.maxConcurrentStreams}</Num>
              <span>{t("concurrency")}</span>
            </li>
            <li className="flex items-baseline gap-1.5">
              <Num>{plan.maxDevices}</Num>
              <span>{t("devices")}</span>
            </li>
          </ul>
          {/* Name the models instead of a bare count: that is what visitors compare plans on. */}
          <div className="border-t border-border pt-3">
            <p className="flex items-baseline gap-1.5 text-[13px] text-fg-muted">
              <Num>{plan.allowedModels.length}</Num>
              <span>{t("models")}</span>
            </p>
            <ul className="mt-1.5 grid gap-1 text-[13px]" data-testid="plan-models">
              {modelNames(plan.allowedModels, catalogById).map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-2">
                  <bdi dir="ltr">{m.name}</bdi>
                  {m.real ? <bdi dir="ltr" className="truncate text-[12px] text-fg-subtle">{m.real}</bdi> : null}
                </li>
              ))}
            </ul>
          </div>
          {(() => {
            const link = (href: string) => (
              <ButtonLink href={href} variant={i === featured ? "primary" : "secondary"} size="sm" className="mt-auto w-full">
                {plan.priceCents === 0 ? t("startFree") : t("choose")}
              </ButtonLink>
            );
            const billing = link(`/${locale}/dashboard/billing`);
            const signUp = link(`/${locale}/sign-up`);
            if (signedIn === undefined) return <SignedInSwitch signedIn={billing} signedOut={signUp} />;
            return signedIn ? billing : signUp;
          })()}
        </Card>
      ))}
    </div>
  );
}
