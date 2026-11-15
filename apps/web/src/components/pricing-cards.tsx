import { getTranslations } from "next-intl/server";
import { plans } from "@deepcode/db";
import { Card, Badge, Num } from "@/components/ui/primitives";
import { formatPrice } from "@/lib/money";

/** Shared plan cards (docs/plan/03 §3.1): one source — the plans table. */
export async function PricingCards({
  plans: rows,
  locale,
  compact = false,
}: {
  plans: Array<typeof plans.$inferSelect>;
  locale: string;
  compact?: boolean;
}) {
  const t = await getTranslations({ locale: locale as "ar" | "en", namespace: "pricing" });
  return (
    <div className={compact ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"}>
      {rows.map((plan, i) => (
        <Card key={plan.id} className="p-5 flex flex-col gap-3" accent={i === 2}>
          <div className="flex items-center justify-between">
            <p className="font-semibold">{locale === "ar" ? plan.nameAr : plan.nameEn}</p>
            {i === 2 ? <Badge tone="primary">{t("placeholder")}</Badge> : <Badge>{t("placeholder")}</Badge>}
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
            <li className="flex items-baseline gap-1.5">
              <Num>{plan.allowedModels.length}</Num>
              <span>{t("models")}</span>
            </li>
          </ul>
        </Card>
      ))}
    </div>
  );
}
