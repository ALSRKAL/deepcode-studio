import { getTranslations } from "next-intl/server";
import { plans } from "@deepcode/db";
import { SignedInSwitch } from "@/components/signed-in";
import { ButtonLink } from "@/components/ui/button";
import { formatPrice } from "@/lib/money";

/**
 * Compact plan comparison for the landing page. Phones get a stacked list with
 * the CTA visible without horizontal scrolling; from md up the same facts are a
 * comparison table. Full cards live on /pricing.
 */
export async function PlanTable({ rows, locale }: { rows: Array<typeof plans.$inferSelect>; locale: string }) {
  const t = await getTranslations({ locale: locale as "ar" | "en", namespace: "pricing" });
  if (rows.length === 0) return <p className="text-[15px] text-fg-muted">{t("empty")}</p>;
  const pro = rows.find((plan) => plan.tier === "pro")?.id;
  const name = (plan: (typeof rows)[number]) => (locale === "ar" ? plan.nameAr : plan.nameEn);
  const ctaFor = (plan: (typeof rows)[number]) => {
    const cta = (href: string) => (
      <ButtonLink href={href} variant={plan.id === pro ? "primary" : "secondary"} size="sm">
        {plan.priceCents === 0 ? t("startFree") : t("choose")}
      </ButtonLink>
    );
    return <SignedInSwitch signedIn={cta(`/${locale}/dashboard/billing`)} signedOut={cta(`/${locale}/sign-up`)} />;
  };

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {rows.map((plan) => (
          <div key={plan.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{name(plan)}</p>
                {plan.id === pro ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-hover">{t("recommended")}</span>
                ) : null}
              </div>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="tabular text-[15px] font-semibold">{formatPrice(plan.priceCents, plan.currency)}</span>
                <span className="text-[12px] text-fg-muted">{t("perMonth")}</span>
              </p>
              <p className="mt-1 text-[12px] text-fg-muted">
                {plan.creditsPerPeriod.toLocaleString("en-US")} {t("credits")} · {t("modelsCount", { count: plan.allowedModels.length })} · {t("devicesCount", { count: plan.maxDevices })}
              </p>
            </div>
            <div className="shrink-0">{ctaFor(plan)}</div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block" role="region" tabIndex={0} aria-label={t("compareTitle")}>
        <table className="w-full min-w-[680px] text-[14px]">
          <caption className="sr-only">{t("compareTitle")}</caption>
          <thead className="border-b border-border bg-surface-2 text-[13px] text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t("plan")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium">{t("perMonth")}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t("credits")}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t("models")}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium">{t("devices")}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium"><span className="sr-only">{t("choose")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((plan) => (
              <tr key={plan.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{name(plan)}</span>
                    {plan.id === pro ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-hover">{t("recommended")}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3"><span className="tabular">{formatPrice(plan.priceCents, plan.currency)}</span></td>
                <td className="px-4 py-3 text-end tabular">{plan.creditsPerPeriod.toLocaleString("en-US")}</td>
                <td className="px-4 py-3 text-end tabular">{plan.allowedModels.length}</td>
                <td className="px-4 py-3 text-end tabular">{plan.maxDevices}</td>
                <td className="px-4 py-3 text-end">{ctaFor(plan)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
