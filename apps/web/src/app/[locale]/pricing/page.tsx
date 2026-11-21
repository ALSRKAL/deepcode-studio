import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingCards } from "@/components/pricing-cards";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { TrialOffer } from "@/components/trial-offer";

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const publicPlans = await db()
    .db.select()
    .from(plans)
    .where(and(eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <SectionTitle as="h1" sub={t("sub")}>
          {t("title")}
        </SectionTitle>
        {env.TRIAL_ENABLED ? (
          <TrialOffer />
        ) : null}
        <div className="mt-8">
          <PricingCards plans={publicPlans} locale={locale} />
        </div>
        <Card className="mt-10 p-6 max-w-3xl">
          <p className="font-medium">{t("transparencyTitle")}</p>
          <p className="mt-2 text-[14px] leading-7 text-fg-muted">{t("transparencyBody")}</p>
          <p className="mt-3">
            <a href={`/${locale}/docs#model-prices`} className="text-primary hover:underline underline-offset-2 text-[14px]">
              {t("perModelPrices")}
            </a>
          </p>
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}

// Public, identical for every visitor: rendered on first request, then served from
// cache and refreshed at most every 60 s (2026-11-21: rendering per visit gave 11 req/s
// at 10 s latency under load). The empty list enables that runtime cache without
// prerendering at build time (the image build has no database).
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}
