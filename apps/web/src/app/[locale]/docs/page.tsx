import { getTranslations, setRequestLocale } from "next-intl/server";
import { desc, eq, inArray } from "drizzle-orm";
import { catalogModels, modelPrices, plans } from "@deepcode/db";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { CopyButton } from "@/components/ui/client";
import { LocaleLink } from "@/components/locale-link";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/siteUrl";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.docs" });
  return pageMetadata({ locale, path: "/docs", title: t("title"), description: t("description") });
}

const SECTIONS = [
  "quickstart",
  "install",
  "key",
  "request",
  "auth",
  "models",
  "mcp",
  "billing",
  "troubleshooting",
  "security",
] as const;

export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("docs");
  const p = await getTranslations("pricing");
  const common = await getTranslations("common");
  const footer = await getTranslations("footer");
  const gatewayBase = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? siteUrl()).replace(/\/$/, "");
  const publicPlans = await db().db.select().from(plans).where(eq(plans.isPublic, true));
  const publicModelIds = [...new Set(publicPlans.flatMap((plan) => plan.allowedModels))];
  const models = publicModelIds.length
    ? await db()
        .db.select()
        .from(catalogModels)
        .where(inArray(catalogModels.id, publicModelIds))
        .orderBy(catalogModels.sortOrder)
    : [];
  const priceRows = publicModelIds.length
    ? await db()
        .db.select()
        .from(modelPrices)
        .where(inArray(modelPrices.model, publicModelIds))
        .orderBy(desc(modelPrices.effectiveFrom))
    : [];
  const latestPrices = new Map<string, (typeof priceRows)[number]>();
  for (const row of priceRows) if (!latestPrices.has(row.model)) latestPrices.set(row.model, row);

  const copy = `curl ${gatewayBase}/v1/chat/completions \\
  -H "Authorization: Bearer sk-dc-…" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"hy4-flash-free","stream":true,
       "messages":[{"role":"user","content":"hello"}]}'`;

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-16">
        <header className="max-w-3xl">
          <h1 className="text-display-sm font-semibold">{t("title")}</h1>
          <p className="mt-3 text-[16px] leading-7 text-fg-muted">{t("sub")}</p>
        </header>
        <div className="mt-10 grid gap-10 md:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label={t("toc")} className="h-max md:sticky md:top-24">
            <p className="text-[13px] font-medium text-fg">{t("toc")}</p>
            <ul className="mt-3 grid gap-1 text-[14px]">
              {SECTIONS.map((section) => (
                <li key={section}>
                  <a href={`#${section}`} className="inline-flex min-h-10 items-center text-fg-muted hover:text-fg">
                    {t(`${section}Title`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="grid min-w-0 gap-12">
            <section id="quickstart" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("quickstartTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("quickstartBody")}</p>
              <div className="mt-4 grid gap-4">
                <div className="flex flex-wrap gap-3 text-[14px]">
                  <LocaleLink locale={locale} href="/download" className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 font-medium text-primary-fg hover:bg-primary-hover">
                    {t("downloadApp")}
                  </LocaleLink>
                  <LocaleLink locale={locale} href="/dashboard/keys" className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 font-medium hover:bg-surface-2">
                    {t("openKeys")}
                  </LocaleLink>
                </div>
                <div className="flex min-w-0 items-start gap-2">
                  <LtrIsland as="pre" tabIndex={0} className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-ink p-4 text-[12.5px] leading-6 text-ink-fg">
                    {copy}
                  </LtrIsland>
                  <CopyButton value={copy} label={common("copy")} copiedLabel={common("copied")} />
                </div>
              </div>
            </section>

            <section id="install" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("installTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("installBody")}</p>
            </section>

            <section id="key" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("keyTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("keyBody")}</p>
            </section>

            <section id="request" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("requestTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("requestBody")}</p>
              <div className="mt-4">
                <h3 className="text-[15px] font-semibold">{t("apiTitle")}</h3>
                <p className="mt-1 text-[14px] text-fg-muted">{t("apiBody")}</p>
                <Card className="mt-3 p-4">
                  <dl className="grid gap-2 text-[13px]" dir="ltr">
                    {[
                      ["POST", "/v1/chat/completions"],
                      ["POST", "/v1/messages"],
                      ["POST", "/v1/responses"],
                      ["POST", "/v1beta/models/<model>:generateContent"],
                      ["GET", "/v1/models"],
                      ["GET", "/v1/subscription/status"],
                    ].map(([method, path]) => (
                      <div key={path} className="flex flex-wrap justify-between gap-2">
                        <dt className="text-fg-subtle">{method}</dt>
                        <dd className="min-w-0 break-all font-mono">{gatewayBase}{path}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </div>
            </section>

            <section id="auth" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("authTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("authBody")}</p>
            </section>

            <section id="models" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("modelsTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("modelsBody")}</p>
              <div role="region" tabIndex={0} aria-label={t("modelsTitle")} className="mt-4 max-h-[520px] overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-[14px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-[13px] text-fg-subtle">
                      <th scope="col" className="px-4 py-3 text-start font-medium">{p("model")}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{t("context")}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{p("perMillion")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => {
                      const price = latestPrices.get(model.id);
                      return (
                        <tr key={model.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <bdi dir="ltr" className="font-medium">{model.displayName}</bdi>
                          </td>
                          <td className="px-4 py-3 text-end tabular">
                            {model.contextWindow ? <bdi dir="ltr">{model.contextWindow.toLocaleString("en-US")}</bdi> : "—"}
                          </td>
                          <td className="px-4 py-3 text-end text-[13px] text-fg-muted">
                            {price ? (
                              <bdi dir="ltr">
                                {Number(price.inputPerMTok).toLocaleString("en-US")} / {Number(price.outputPerMTok).toLocaleString("en-US")}
                              </bdi>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-fg-subtle">{p("transparencyBody")}</p>
            </section>

            <section id="model-prices" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("modelsTableTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{p("modelPricesSub")}</p>
              <div role="region" tabIndex={0} aria-label={t("modelsTableTitle")} className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-[14px]">
                  <thead>
                    <tr className="border-b border-border bg-surface text-[13px] text-fg-subtle">
                      <th scope="col" className="px-4 py-3 text-start font-medium">{p("model")}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{p("input")}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{p("cached")}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{p("output")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...latestPrices.values()].map((price) => (
                      <tr key={price.model} className="border-b border-border last:border-0">
                        <td className="px-4 py-3"><bdi dir="ltr">{price.model}</bdi></td>
                        <td className="px-4 py-3 text-end tabular"><Num>{Number(price.inputPerMTok).toLocaleString("en-US")}</Num></td>
                        <td className="px-4 py-3 text-end tabular"><Num>{Number(price.cachedInputPerMTok).toLocaleString("en-US")}</Num></td>
                        <td className="px-4 py-3 text-end tabular"><Num>{Number(price.outputPerMTok).toLocaleString("en-US")}</Num></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-fg-subtle">{p("perMillion")}</p>
            </section>

            <section id="mcp" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("mcpTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("mcpBody")}</p>
            </section>

            <section id="billing" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("billingTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("billingBody")}</p>
            </section>

            <section id="troubleshooting" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("troubleshootingTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("troubleshootingBody")}</p>
            </section>

            <section id="security" className="min-w-0 scroll-mt-24">
              <h2 className="text-scale-md font-semibold">{t("securityTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("securityBody")}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-[14px]">
                <LocaleLink locale={locale} href="/security" className="text-primary hover:underline underline-offset-2">
                  {t("securityTitle")}
                </LocaleLink>
                <LocaleLink locale={locale} href="/contact" className="text-primary hover:underline underline-offset-2">
                  {footer("support")}
                </LocaleLink>
              </div>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

