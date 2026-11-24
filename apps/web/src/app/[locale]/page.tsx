import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { catalogModels, plans, releases, TRIAL_PLAN } from "@deepcode/db";
import { absoluteUrl, pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/siteUrl";
import { JsonLd } from "@/components/json-ld";
import { db } from "@/lib/db";
import { SignedInSwitch } from "@/components/signed-in";
import { env } from "@/lib/env";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ProductWindow } from "@/components/home/product-window";
import { ButtonLink } from "@/components/ui/button";
import { LtrIsland } from "@/components/ltr-island";
import { PlanTable } from "@/components/plan-table";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.home" });
  return pageMetadata({ locale, path: "/", title: t("title"), description: t("description") });
}

function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(tokens / 1024)}K`;
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const f = await getTranslations("faq");
  const p = await getTranslations("pricing");
  const d = await getTranslations("download");
  const nav = await getTranslations("nav");
  const publicPlans = await db().db.select().from(plans).where(eq(plans.isPublic, true)).orderBy(plans.sortOrder);

  const planName = (plan: (typeof publicPlans)[number]) => (locale === "ar" ? plan.nameAr : plan.nameEn);
  const publicModelIds = [...new Set(publicPlans.flatMap((plan) => plan.allowedModels))];
  const catalogRows = publicModelIds.length
    ? await db().db.select().from(catalogModels).where(inArray(catalogModels.id, publicModelIds))
    : [];
  const models = catalogRows
    .filter((model) => model.status === "active")
    .map((model) => {
      const first = publicPlans.find((plan) => plan.allowedModels.includes(model.id));
      return {
        id: model.id,
        name: model.displayName,
        context: model.contextWindow ? contextLabel(model.contextWindow) : "",
        plan: first ? planName(first) : "",
        planOrder: first ? publicPlans.indexOf(first) : publicPlans.length,
        trial: (TRIAL_PLAN.allowedModels as readonly string[]).includes(model.id),
      };
    })
    .sort((a, b) => a.planOrder - b.planOrder || a.name.localeCompare(b.name));
  // Show the ladder, not eight Starter models: two examples from each tier first.
  const featuredModels = (() => {
    const picked = [0, 1, 2, 3].flatMap((order) => models.filter((model) => model.planOrder === order).slice(0, 2));
    const seen = new Set(picked.map((model) => model.id));
    for (const model of models) {
      if (picked.length >= 8) break;
      if (!seen.has(model.id)) {
        picked.push(model);
        seen.add(model.id);
      }
    }
    return picked.slice(0, 8);
  })();

  const releaseRows = await db()
    .db.select()
    .from(releases)
    .where(and(eq(releases.channel, "stable"), isNotNull(releases.publishedAt)))
    .orderBy(desc(sql`${releases.publishedAt}`));
  const latestVersion = releaseRows[0]?.version;
  const latestRows = latestVersion ? releaseRows.filter((row) => row.version === latestVersion) : [];
  const asset = (platform: string, arch: string, fileKind: string) =>
    latestRows.find((row) => row.platform === platform && row.arch === arch && row.fileKind === fileKind)?.url;

  const downloads = [
    { key: "windows", label: d("windows"), detail: "Windows 10/11", href: asset("win", "x64", "exe") },
    { key: "mac-arm", label: `${d("macos")} · ${d("appleSilicon")}`, detail: "macOS 12+", href: asset("mac", "arm64", "dmg") },
    { key: "mac-intel", label: `${d("macos")} · ${d("intel")}`, detail: "macOS 12+", href: asset("mac", "x64", "dmg") },
    { key: "linux", label: d("linux"), detail: "AppImage · deb · rpm", href: asset("linux", "x64", "AppImage") },
  ];

  const faqs: Array<[string, string]> = [
    [f("credit"), f("creditBody")],
    [f("limit"), f("limitBody")],
    [f("byok"), f("byokBody")],
    [f("data"), f("dataBody")],
    [f("refund"), f("refundBody")],
    [f("os"), f("osBody")],
  ];

  const site = siteUrl();
  const softwareJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "DeepCode Studio",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows, macOS, Linux",
    description: t("heroSub"),
    url: absoluteUrl(`/${locale}`),
    ...(latestVersion ? { softwareVersion: latestVersion } : {}),
    offers: publicPlans.map((plan) => ({
      "@type": "Offer",
      name: locale === "ar" ? plan.nameAr : plan.nameEn,
      price: (plan.priceCents / 100).toFixed(2),
      priceCurrency: plan.currency,
      url: `${site}/${locale}/pricing`,
      availability: "https://schema.org/InStock",
    })),
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <>
      <JsonLd data={[softwareJsonLd, faqJsonLd]} />
      <SiteHeader />
      <main id="main">
        {/* 1 — Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-12 pb-16 md:pt-20 md:pb-20">
          <h1 className="max-w-4xl text-display font-semibold tracking-[-0.03em] text-balance [html[lang=ar]_&]:tracking-normal">
            {t("heroTitle")}
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-8 text-fg-muted md:text-[18px]">{t("heroSub")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href={`/${locale}/download`} size="lg">
              {t("ctaDownload")}
            </ButtonLink>
            {env.TRIAL_ENABLED ? (
              <SignedInSwitch
                signedIn={
                  <ButtonLink href={`/${locale}/dashboard`} size="lg" variant="secondary">
                    {nav("dashboard")}
                  </ButtonLink>
                }
                signedOut={
                  <ButtonLink href={`/${locale}/sign-up`} size="lg" variant="secondary">
                    {t("ctaTrial")}
                  </ButtonLink>
                }
              />
            ) : (
              <ButtonLink href={`/${locale}/pricing`} size="lg" variant="secondary">
                {p("allPlans")}
              </ButtonLink>
            )}
          </div>
          <p className="mt-4 text-[13px] text-fg-subtle">{t("heroNote")}</p>
          <div className="mt-12 md:mt-16">
            <ProductWindow />
          </div>
        </section>

        {/* 2 — Product proof */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2 md:py-28">
            <div>
              <h2 className="text-display-sm font-semibold tracking-[-0.02em] [html[lang=ar]_&]:tracking-normal">{t("proofTitle")}</h2>
              <p className="mt-4 max-w-lg text-[16px] leading-7 text-fg-muted">{t("proofBody")}</p>
              <ul className="mt-8 grid gap-6">
                {(["1", "2", "3"] as const).map((n) => (
                  <li key={n} className="grid gap-1.5">
                    <h3 className="text-[17px] font-semibold">{t(`proof${n}Title`)}</h3>
                    <p className="max-w-md text-[15px] leading-7 text-fg-muted">{t(`proof${n}Body`)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <LtrIsland as="pre" tabIndex={0} className="overflow-x-auto rounded-lg bg-ink p-5 text-[13px] leading-7 text-ink-fg">
              <span className="block text-ink-muted">{'$ deepcode "add email validation"'}</span>
              <span className="mt-3 block text-accent-glow">plan</span>
              <span className="block text-ink-fg/90">{"read src/forms/signup.tsx"}</span>
              <span className="block text-ink-fg/90">{"write the diff, then run the tests"}</span>
              <span className="mt-3 block text-accent-glow">edit</span>
              <span className="block text-ink-fg/90">{"src/forms/signup.tsx  +9 −2"}</span>
              <span className="mt-3 block text-accent-glow">test</span>
              <span className="block text-code-add">{"✓ tests passed"}</span>
            </LtrIsland>
          </div>
        </section>

        {/* 3 — Models */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-display-sm font-semibold tracking-[-0.02em] [html[lang=ar]_&]:tracking-normal">{t("modelsTitle")}</h2>
              <p className="mt-3 max-w-2xl text-[16px] leading-7 text-fg-muted">{t("modelsSub")}</p>
            </div>
            <a href={`/${locale}/docs#models`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-primary hover:underline underline-offset-2">
              {t("modelsAll")}
            </a>
          </div>
          <div className="mt-8 max-h-[520px] overflow-auto rounded-lg border border-border bg-surface" role="region" tabIndex={0} aria-label={t("modelsTitle")}>
            <table className="w-full min-w-0 text-[14px] sm:min-w-[560px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-start text-[13px] text-fg-subtle">
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("colModel")}</th>
                  <th scope="col" className="hidden px-5 py-3 text-end font-medium sm:table-cell">{t("colContext")}</th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">{t("colPlan")}</th>
                </tr>
              </thead>
              <tbody>
                {featuredModels.map((model) => (
                  <tr key={model.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 font-medium"><bdi dir="ltr">{model.name}</bdi></td>
                    <td className="hidden px-5 py-3.5 text-end tabular sm:table-cell"><bdi dir="ltr">{model.context}</bdi></td>
                    <td className="px-5 py-3.5">
                      <span>{model.plan}</span>
                      {model.trial ? (
                        <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] text-primary-hover">{t("trialIncluded")}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4 — Pricing */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-display-sm font-semibold tracking-[-0.02em] [html[lang=ar]_&]:tracking-normal">{t("pricingTitle")}</h2>
                <p className="mt-3 max-w-2xl text-[16px] leading-7 text-fg-muted">{t("pricingSub")}</p>
              </div>
              <a href={`/${locale}/pricing`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-primary hover:underline underline-offset-2">
                {p("allPlans")}
              </a>
            </div>
            <div className="mt-8">
              <PlanTable rows={publicPlans} locale={locale} />
            </div>
          </div>
        </section>

        {/* 5 — Download */}
        <section className="bg-ink text-ink-fg">
          <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-display-sm font-semibold tracking-[-0.02em] [html[lang=ar]_&]:tracking-normal">{t("downloadTitle")}</h2>
                <p className="mt-3 max-w-2xl text-[16px] leading-7 text-ink-muted">{t("downloadSub")}</p>
                {latestVersion ? <p className="mt-2 text-[13px] text-ink-muted tabular">v{latestVersion}</p> : null}
              </div>
              <a href={`/${locale}/download`} className="inline-flex min-h-11 items-center text-[14px] font-medium text-accent-glow hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow">
                {d("allBuilds")}
              </a>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {downloads.map((option) => (
                <a
                  key={option.key}
                  href={option.href ?? `/${locale}/download`}
                  className="group flex min-h-16 items-center justify-between gap-4 rounded-lg border border-ink-line bg-ink-2 px-5 py-4 hover:border-accent-glow/60 hover:bg-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow"
                >
                  <span>
                    <span className="block text-[15px] font-medium text-ink-fg">{option.label}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-muted">{option.detail}</span>
                  </span>
                  <span aria-hidden="true" className="text-ink-muted group-hover:text-accent-glow">↓</span>
                </a>
              ))}
            </div>
            <div className="mt-6 grid gap-2 text-[12px] leading-6 text-ink-muted md:grid-cols-2">
              <p>{d("requirementsBody")}</p>
              <p>{d("unsignedBody")}</p>
            </div>
          </div>
        </section>

        {/* 6 — FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-20 md:py-28">
          <h2 className="text-display-sm font-semibold tracking-[-0.02em] [html[lang=ar]_&]:tracking-normal">{t("faqTitle")}</h2>
          <p className="mt-3 text-[16px] leading-7 text-fg-muted">{t("faqSub")}</p>
          <div className="mt-8 border-y border-border">
            {faqs.map(([question, answer]) => (
              <details key={question} className="group border-b border-border py-5 last:border-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  {question}
                  <span aria-hidden="true" className="text-[20px] leading-none text-fg-subtle transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-7 text-fg-muted">{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

// Rendered per request so the CSP nonce on Next's scripts and our JSON-LD always
// match. Public pages keep no server session read, so this stays cheap.
