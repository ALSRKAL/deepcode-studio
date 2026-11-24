import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card } from "@/components/ui/primitives";
import { LocaleLink } from "@/components/locale-link";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.security" });
  return pageMetadata({ locale, path: "/security", title: t("title"), description: t("description") });
}

export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("security");
  const sections = [
    ["accountTitle", "accountBody"],
    ["transportTitle", "transportBody"],
    ["dataTitle", "dataBody"],
    ["reportTitle", "reportBody"],
  ] as const;
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-display-sm font-semibold">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-7 text-fg-muted">{t("sub")}</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {sections.map(([title, body]) => (
            <Card key={title} className="p-6">
              <h2 className="text-[18px] font-semibold">{t(title)}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t(body)}</p>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-4 text-[14px]">
          <LocaleLink locale={locale} href="/legal/privacy" className="text-primary hover:underline underline-offset-2">
            {t("privacy")}
          </LocaleLink>
          <LocaleLink locale={locale} href="/contact" className="text-primary hover:underline underline-offset-2">
            {t("reportTitle")}
          </LocaleLink>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
