import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/guards";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { IdePreview } from "@/components/ide-preview";
import { Card, SectionTitle, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { LtrIsland } from "@/components/ltr-island";
import { PricingCards } from "@/components/pricing-cards";
import { TrialOffer } from "@/components/trial-offer";
import { env } from "@/lib/env";


/** Landing (docs/plan/03 §3): hero with IDE preview, proof strip, sections 3–9. */
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("landing");
  const f = await getTranslations("faq");
  const user = await currentUser();
  const publicPlans = await db()
    .db.select()
    .from(plans)
    .where(and(eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder);

  const faqs: Array<[string, string]> = [
    [f("credit"), f("creditBody")],
    [f("limit"), f("limitBody")],
    [f("byok"), f("byokBody")],
    [f("data"), f("dataBody")],
    [f("refund"), f("refundBody")],
    [f("os"), f("osBody")],
    [f("offline"), f("offlineBody")],
    [f("zcode"), f("zcodeBody")],
  ];

  return (
    <>
      <SiteHeader signedIn={user !== null} />
      <main>
        {/* 1 — Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12">
          <h1 className="text-scale-2xl font-semibold max-w-3xl">{t("heroTitle")}</h1>
          <p className="mt-4 text-fg-muted text-[16px] leading-7 max-w-2xl">{t("heroSub")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={`/${locale}/download`} size="lg">
              {t("ctaDownload")}
            </ButtonLink>
            <ButtonLink href={`/${locale}/pricing`} variant="secondary" size="lg">
              {t("ctaPricing")}
            </ButtonLink>
          </div>
          <div className="mt-8">
            <IdePreview />
          </div>
        </section>

        {/* 2 — Proof strip */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-5 grid gap-3 md:grid-cols-3 text-[14px] text-fg-muted">
            <span>{t("proofModels")}</span>
            <span>{t("proofRtl")}</span>
            <span>{t("proofLocal")}</span>
          </div>
        </section>

        {/* 3 — Agentic workspace */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-8 md:grid-cols-5">
            <div className="md:col-span-2">
              <SectionTitle>{t("agenticTitle")}</SectionTitle>
              <p className="text-fg-muted text-[15px] leading-7">{t("agenticBody")}</p>
            </div>
            <Card className="md:col-span-3 p-5 ltr-island" >
              <div dir="ltr" className="font-mono text-[12.5px] leading-6">
                <p className="text-fg-subtle">$ deepcode agent --task &quot;add email validation&quot;</p>
                <p className="text-fg-muted mt-2">plan → 2 steps</p>
                <p className="text-success">✓ src/utils.ts (+6 −1)</p>
                <p className="text-success">✓ tests passed (4/4)</p>
              </div>
            </Card>
          </div>
        </section>

        {/* 4+5 — MCP / Skills (7/5 split, not equal cards) */}
        <section className="mx-auto max-w-6xl px-4 pb-16 grid gap-8 md:grid-cols-12">
          <div className="md:col-span-7 min-w-0">
            <SectionTitle>{t("mcpTitle")}</SectionTitle>
            <p className="text-fg-muted text-[15px] leading-7 mb-4">{t("mcpBody")}</p>
            <LtrIsland className="block overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-[12.5px] leading-6" as="pre" tabIndex={0}>
              {`{
  "mcpServers": {
    "docs": { "transport": "stdio", "command": "deepcode-docs" },
    "browser": { "transport": "sse", "url": "http://127.0.0.1:9222/mcp" }
  }
}`}
            </LtrIsland>
          </div>
          <div className="md:col-span-5 min-w-0">
            <SectionTitle>{t("skillsTitle")}</SectionTitle>
            <p className="text-fg-muted text-[15px] leading-7 mb-4">{t("skillsBody")}</p>
            <LtrIsland className="block overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-[12.5px] leading-6" as="pre" tabIndex={0}>
              {`---
name: pdf-extract
description: Extract tables from PDFs
---
1. open the document
2. emit tables as markdown`}
            </LtrIsland>
          </div>
        </section>

        {/* 6 — Multi-model gateway */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 grid gap-8 md:grid-cols-2 items-center">
            <div>
              <SectionTitle>{t("gatewayTitle")}</SectionTitle>
              <p className="text-fg-muted text-[15px] leading-7">{t("gatewayBody")}</p>
            </div>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-medium">DeepCode Studio</span>
                <Badge tone="primary">Pro</Badge>
              </div>
              <div className="mt-3 h-1.5 rounded-sm bg-bg overflow-hidden">
                <div className="h-full w-[37%] bg-primary" />
              </div>
              <div className="mt-2 flex justify-between text-[13px] text-fg-muted tabular font-mono" dir="ltr">
                <span>7,412,350 / 20,000,000</span>
                <span>37.1%</span>
              </div>
            </Card>
          </div>
        </section>

        {/* 7 — Pricing */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <SectionTitle>{t("ctaPricing")}</SectionTitle>
          {env.TRIAL_ENABLED ? <TrialOffer /> : null}
          <div className="mt-8">
            <PricingCards plans={publicPlans} locale={locale} signedIn={user !== null} />
          </div>
        </section>

        {/* 9 — FAQ */}
        <section className="mx-auto max-w-3xl px-4 pb-16">
          <SectionTitle sub={t("faqSubtitle")}>{t("faqTitle")}</SectionTitle>
          <div className="grid gap-3">
            {faqs.map(([q, a]) => (
              <details key={q} className="rounded-lg border border-border bg-surface p-4">
                <summary className="cursor-pointer font-medium text-[15px]">{q}</summary>
                <p className="mt-2 text-[14px] leading-7 text-fg-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
