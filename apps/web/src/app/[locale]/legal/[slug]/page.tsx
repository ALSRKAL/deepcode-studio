import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/** Legal pages: terms, privacy and acceptable use (sections from i18n), plus licences. */
const SLUGS = ["terms", "privacy", "acceptable-use", "licenses"] as const;
type Slug = (typeof SLUGS)[number];

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  if (!SLUGS.includes(slug as Slug)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-fg-muted">404</p>
      </main>
    );
  }
  const titleKey = slug === "acceptable-use" ? "acceptableUse" : slug;
  const title = t.has(titleKey) ? t(titleKey) : slug;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 grid gap-6">
        <h1 className="text-scale-lg font-semibold">{title}</h1>
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
