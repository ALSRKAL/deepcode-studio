import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMetadata } from "@/lib/seo";

/** Legal pages: terms, privacy and acceptable use (sections from i18n), plus licences. */
const SLUGS = ["terms", "privacy", "acceptable-use", "licenses"] as const;
type Slug = (typeof SLUGS)[number];


export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: raw, slug } = await params;
  if (!SLUGS.includes(slug as Slug)) notFound();
  const locale = raw === "en" ? "en" : "ar";
  const legal = await getTranslations({ locale, namespace: "legal" });
  const meta = await getTranslations({ locale, namespace: "meta.legal" });
  const titleKey = slug === "acceptable-use" ? "acceptableUse" : slug;
  return pageMetadata({
    locale,
    path: `/legal/${slug}`,
    title: legal.has(titleKey) ? legal(titleKey) : slug,
    description: meta("description"),
  });
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  if (!SLUGS.includes(slug as Slug)) notFound();
  const titleKey = slug === "acceptable-use" ? "acceptableUse" : slug;
  const title = t.has(titleKey) ? t(titleKey) : slug;

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-16 grid gap-6">
        <h1 className="text-display-sm font-semibold">{title}</h1>
        {slug === "licenses" ? (
          <div className="rounded-lg border border-border bg-surface p-6 text-[14px] leading-7 text-fg-muted">
            <p>{t("licensesBody")}</p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-fg-subtle">{t("updated")}</p>
            <div className="grid gap-6 rounded-lg border border-border bg-surface p-6">
              {(t.raw(`docs.${titleKey}`) as Array<{ h: string; p: string }>).map((section, i) => (
                <section key={section.h} aria-labelledby={`legal-${i}`} className="grid gap-2">
                  <h2 id={`legal-${i}`} className="text-[15px] font-semibold text-fg">
                    {i + 1}. {section.h}
                  </h2>
                  <p className="text-[14px] leading-7 text-fg-muted">{section.p}</p>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
