import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingCards } from "@/components/pricing-cards";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { TrialOffer } from "@/components/trial-offer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.pricing" });
  return pageMetadata({ locale, path: "/pricing", title: t("title"), description: t("description") });
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const publicPlans = await db()
    .db.select()
    .from(plans)
    .where(and(eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "DeepCode Studio",
    description: t("sub"),
    brand: { "@type": "Brand", name: "DeepCode Studio" },
    url: absoluteUrl(`/${locale}/pricing`),
    offers: publicPlans.map((plan) => ({
      "@type": "Offer",
      name: locale === "ar" ? plan.nameAr : plan.nameEn,
      price: (plan.priceCents / 100).toFixed(2),
      priceCurrency: plan.currency,
      availability: "https://schema.org/InStock",
      url: absoluteUrl(`/${locale}/pricing`),
    })),
  };

  return (
    <>
      <JsonLd data={productJsonLd} />
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-16">
        <SectionTitle as="h1" sub={t("sub")}>
          {t("title")}
        </SectionTitle>
        {env.TRIAL_ENABLED ? (
          <TrialOffer />
        ) : null}
        <div className="mt-8">
          <PricingCards plans={publicPlans} locale={locale} />
        </div>
        <div className="mt-4 grid gap-1 text-[13px] text-fg-subtle">
          <p>{t("taxNote")}</p>
          <p>{t("cancelNote")}</p>
        </div>
        <Card className="mt-10 max-w-3xl p-6">
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

// Rendered per request so the CSP nonce on Next's scripts stays valid.
