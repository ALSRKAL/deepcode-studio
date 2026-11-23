import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { catalogModels, plans, TRIAL_PLAN } from "@deepcode/db";
import { db } from "@/lib/db";
import { SignedInSwitch } from "@/components/signed-in";
import { env } from "@/lib/env";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ProductWindow } from "@/components/home/product-window";
import { ButtonLink } from "@/components/ui/button";
import { LtrIsland } from "@/components/ltr-island";
import { PricingCards } from "@/components/pricing-cards";
import { TrialOffer } from "@/components/trial-offer";

/** Real model behind a branded one: "… (DeepSeek V4.1 Flash)." → "DeepSeek V4.1 Flash". */
function realModel(description: string): string {
  return /\(([^)]+)\)\.?$/.exec(description)?.[1] ?? "";
}

function contextLabel(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  // The split line (brand signature): a short cyan rule before every section label.
  return (
    <p className="flex items-center gap-3 text-[13px] font-medium tracking-wide text-primary">
      <span aria-hidden="true" className="h-px w-8 bg-primary" />
      {children}
    </p>
  );
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const f = await getTranslations("faq");
  const l = await getTranslations("landing");
  const publicPlans = await db().db.select().from(plans).where(and(eq(plans.isPublic, true))).orderBy(plans.sortOrder);

  const planName = (p: (typeof publicPlans)[number]) => (locale === "ar" ? p.nameAr : p.nameEn);
  const publicModelIds = [...new Set(publicPlans.flatMap((p) => p.allowedModels))];
  const catalogRows = publicModelIds.length
    ? await db()
        .db.select()
        .from(catalogModels)
        .where(inArray(catalogModels.id, publicModelIds))
    : [];
  const models = catalogRows
    .filter((m) => m.status === "active")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
    .map((m) => {
      const first = publicPlans.find((p) => p.allowedModels.includes(m.id));
      return {
        id: m.id,
        name: m.displayName,
        runs: realModel(m.description ?? ""),
        context: m.contextWindow ? contextLabel(m.contextWindow) : "",
        plan: first ? planName(first) : "",
        trial: (TRIAL_PLAN.allowedModels as readonly string[]).includes(m.id),
      };
    });

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
      <SiteHeader />
      <main>
        {/* 1 — Hero */}
        <section className="relative overflow-hidden">
          {/* A quiet grid that fades out: depth behind the window, not decoration on text. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]"
          />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-10 md:pt-24">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="mt-5 max-w-4xl text-display font-semibold tracking-[-0.02em] [html[lang=ar]_&]:tracking-normal">
              {t("heroTitle")}
            </h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-8 text-fg-muted">{t("heroSub")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <SignedInSwitch
                signedIn={<ButtonLink href={`/${locale}/dashboard`} size="lg">{t("ctaTrial")}</ButtonLink>}
                signedOut={<ButtonLink href={`/${locale}/sign-up`} size="lg">{t("ctaTrial")}</ButtonLink>}
              />
              <ButtonLink href={`/${locale}/download`} variant="secondary" size="lg">
                {t("ctaDownload")}
              </ButtonLink>
            </div>
            <p className="mt-4 text-[13px] text-fg-subtle">{t("heroNote")}</p>
          </div>
          <div className="relative mx-auto max-w-6xl px-4 pb-16">
            <ProductWindow />
          </div>
        </section>

        {/* 2 — Model providers */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-10 gap-y-3 px-4 py-6">
            <p className="text-[13px] text-fg-subtle">{t("stripLabel")}</p>
            <ul dir="ltr" className="flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[14px] font-medium text-fg-muted">
              {["DeepSeek", "GLM", "Qwen", "Kimi", "gpt-oss"].map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* 3 — Features: a bento with one real visual per feature */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <Eyebrow>{t("featuresEyebrow")}</Eyebrow>
          <h2 className="mt-4 max-w-3xl text-display-sm font-semibold tracking-[-0.01em]">{t("featuresTitle")}</h2>
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-12">
            <article className="min-w-0 rounded-[14px] border border-border bg-surface p-6 md:col-span-7">
              <h3 className="text-[17px] font-semibold">{t("f1Title")}</h3>
              <p className="mt-2 max-w-lg text-[15px] leading-7 text-fg-muted">{t("f1Body")}</p>
              <LtrIsland as="pre" tabIndex={0} className="mt-6 block overflow-x-auto rounded-[10px] bg-ink p-4 text-[12.5px] leading-6 text-ink-fg">
                <span className="text-ink-muted">{"$ deepcode \"fix the checkout total\"\n"}</span>
                <span className="text-accent-glow">{"plan  "}</span>
                {"read cart.ts → patch totals → run tests\n"}
                <span className="text-[#6ee7b7]">{"edit  "}</span>
                {"src/cart.ts  +14 −3\n"}
                <span className="text-[#6ee7b7]">{"test  "}</span>
                {"38 passed in 2.1s"}
              </LtrIsland>
            </article>

            <article className="min-w-0 rounded-[14px] border border-border bg-surface p-6 md:col-span-5">
              <h3 className="text-[17px] font-semibold">{t("f2Title")}</h3>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("f2Body")}</p>
              <div className="mt-6 rounded-[10px] border border-border bg-bg p-4">
                <p dir="rtl" lang="ar" className="text-[15px] leading-7">
                  أنشئ دالة <LtrIsland className="rounded bg-surface-2 px-1.5 py-0.5 text-[12.5px] text-primary">formatPrice()</LtrIsland> تعرض السعر بالروبية.
                </p>
                <div className="mt-3 border-s-2 border-primary ps-3" dir="ltr">
                  <LtrIsland className="block text-[12.5px] text-fg-muted">{"formatPrice(29900) // \"₹299\""}</LtrIsland>
                </div>
              </div>
            </article>

            <article className="min-w-0 rounded-[14px] border border-border bg-surface p-6 md:col-span-4">
              <h3 className="text-[17px] font-semibold">{t("f3Title")}</h3>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("f3Body")}</p>
              <ul dir="ltr" className="mt-6 grid gap-1.5 rounded-[10px] border border-border bg-bg p-2 text-[13px]">
                {models.slice(0, 3).map((m, i) => (
                  <li key={m.id} className={`flex items-center justify-between rounded-md px-2.5 py-2 ${i === 0 ? "bg-surface shadow-[0_1px_0_var(--color-border)]" : ""}`}>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-fg-subtle">{m.runs}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="min-w-0 rounded-[14px] border border-border bg-surface p-6 md:col-span-4">
              <h3 className="text-[17px] font-semibold">{t("f4Title")}</h3>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("f4Body")}</p>
              <div className="mx-auto mt-6 w-40 rounded-[22px] border-[5px] border-ink bg-ink p-1">
                <div className="rounded-[16px] bg-ink-2 px-3 py-4 text-ink-fg">
                  <p className="text-[10px] text-ink-muted">DeepCode Studio</p>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
                    {t("phoneConnected")}
                  </p>
                  <div className="mt-3 grid gap-1.5">
                    <span className="h-2 rounded-full bg-ink-3" />
                    <span className="h-2 w-3/4 rounded-full bg-ink-3" />
                    <span className="h-2 w-1/2 rounded-full bg-accent-glow/70" />
                  </div>
                </div>
              </div>
            </article>

            <article className="min-w-0 rounded-[14px] border border-border bg-surface p-6 md:col-span-4">
              <h3 className="text-[17px] font-semibold">{t("f5Title")}</h3>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("f5Body")}</p>
              <ul dir="ltr" className="mt-6 flex flex-wrap gap-2 font-mono text-[12px]">
                {["impeccable", "frontend-design", "react-best-practices", "webapp-testing", "mcp-builder", "xlsx", "pdf"].map((s) => (
                  <li key={s} className="rounded-md border border-border bg-bg px-2 py-1 text-fg-muted">
                    {s}
                  </li>
                ))}
              </ul>
            </article>

            <article className="flex min-w-0 flex-col gap-6 rounded-[14px] border border-border bg-surface p-6 md:col-span-12 md:flex-row md:items-center">
              <div className="md:w-1/2">
                <h3 className="text-[17px] font-semibold">{t("f6Title")}</h3>
                <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("f6Body")}</p>
              </div>
              <div className="md:w-1/2">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-fg-muted">{t("usageLabel")}</span>
                  <span dir="ltr" className="tabular font-mono">2,140,500 / 7,000,000</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full w-[31%] rounded-full bg-primary" />
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* 4 — How it works */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <Eyebrow>{t("stepsEyebrow")}</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-display-sm font-semibold tracking-[-0.01em]">{t("stepsTitle")}</h2>
            <ol className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-3">
              {(["s1", "s2", "s3"] as const).map((k, i) => (
                <li key={k} className="border-t border-border pt-6">
                  <span dir="ltr" className="font-mono text-[13px] text-primary">0{i + 1}</span>
                  <h3 className="mt-3 text-[19px] font-semibold">{t(`${k}Title`)}</h3>
                  <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t(`${k}Body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 5 — Models (real data from the catalog and the plans) */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <Eyebrow>{t("modelsEyebrow")}</Eyebrow>
          <h2 className="mt-4 text-display-sm font-semibold tracking-[-0.01em]">{t("modelsTitle")}</h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-7 text-fg-muted">{t("modelsSub")}</p>
          <div className="mt-10 overflow-x-auto rounded-[14px] border border-border bg-surface" role="region" tabIndex={0} aria-label={t("modelsTitle")}>
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="border-b border-border text-start text-[12.5px] text-fg-subtle">
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("colModel")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("colRuns")}</th>
                  <th scope="col" className="px-5 py-3 text-end font-medium">{t("colContext")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("colPlan")}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 font-medium"><bdi dir="ltr">{m.name}</bdi></td>
                    <td className="px-5 py-3.5 text-fg-muted"><bdi dir="ltr">{m.runs}</bdi></td>
                    <td className="px-5 py-3.5 text-end tabular font-mono text-[13px]"><bdi dir="ltr">{m.context}</bdi></td>
                    <td className="px-5 py-3.5">
                      <span>{m.plan}</span>
                      {m.trial ? (
                        <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] text-primary">{t("trialIncluded")}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 6 — Pricing */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <Eyebrow>{t("pricingEyebrow")}</Eyebrow>
            <h2 className="mt-4 text-display-sm font-semibold tracking-[-0.01em]">{t("pricingTitle")}</h2>
            {env.TRIAL_ENABLED ? <TrialOffer /> : null}
            <div className="mt-8">
              <PricingCards plans={publicPlans} locale={locale} />
            </div>
          </div>
        </section>

        {/* 7 — FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-20">
          <Eyebrow>{t("faqEyebrow")}</Eyebrow>
          <h2 className="mt-4 text-display-sm font-semibold tracking-[-0.01em]">{l("faqTitle")}</h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {faqs.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden="true" className="text-[20px] leading-none text-fg-subtle transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-7 text-fg-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 8 — Closing band */}
        <section className="px-4 pb-20">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[20px] bg-ink px-6 py-14 text-ink-fg md:px-14 md:py-20">
            <h2 className="max-w-2xl text-display-sm font-semibold tracking-[-0.01em]">{t("finalTitle")}</h2>
            <p className="mt-4 max-w-xl text-[16px] leading-7 text-ink-muted">{t("finalSub")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <SignedInSwitch
                signedIn={<ButtonLink href={`/${locale}/dashboard`} size="lg" className="!bg-accent-glow !text-ink hover:!bg-[#67e8f9]">{t("ctaTrial")}</ButtonLink>}
                signedOut={<ButtonLink href={`/${locale}/sign-up`} size="lg" className="!bg-accent-glow !text-ink hover:!bg-[#67e8f9]">{t("ctaTrial")}</ButtonLink>}
              />
              <ButtonLink href={`/${locale}/download`} size="lg" variant="secondary" className="!border-ink-line !bg-transparent !text-ink-fg hover:!bg-ink-3">
                {t("ctaDownload")}
              </ButtonLink>
            </div>
          </div>
        </section>
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
