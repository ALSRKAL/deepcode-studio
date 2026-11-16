import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/guards";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingCards } from "@/components/pricing-cards";
import { Card, SectionTitle } from "@/components/ui/primitives";

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("pricing");
  const user = await currentUser();
  const publicPlans = await db()
    .db.select()
    .from(plans)
    .where(and(eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder);

  return (
    <>
      <SiteHeader signedIn={user !== null} />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <SectionTitle as="h1" sub={t("sub")}>
          {t("title")}
        </SectionTitle>
        {env.TRIAL_ENABLED ? (
          <p className="mx-auto mt-6 max-w-2xl rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-center text-[14px]">
            <strong className="font-semibold">{t("trialOfferTitle")}</strong> {t("trialOfferBody")}
          </p>
        ) : null}
        <PricingCards plans={publicPlans} locale={locale} signedIn={user !== null} />
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
