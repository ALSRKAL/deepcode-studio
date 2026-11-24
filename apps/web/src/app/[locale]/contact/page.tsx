import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card } from "@/components/ui/primitives";
import { pageMetadata } from "@/lib/seo";
import { env } from "@/lib/env";

const GITHUB_ISSUES = "https://github.com/ALSRKAL/deepcode-desktop/issues";
const SECURITY_ADVISORY = "https://github.com/ALSRKAL/deepcode-desktop/security/advisories/new";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.contact" });
  return pageMetadata({ locale, path: "/contact", title: t("title"), description: t("description") });
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-display-sm font-semibold">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-7 text-fg-muted">{t("sub")}</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <h2 className="text-[18px] font-semibold">{t("githubTitle")}</h2>
            <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("githubBody")}</p>
            <a
              href={GITHUB_ISSUES}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex min-h-11 items-center rounded-sm bg-primary px-5 text-[14px] font-medium text-primary-fg hover:bg-primary-hover"
            >
              {t("githubCta")}
            </a>
          </Card>
          {env.SUPPORT_EMAIL ? (
            <Card className="p-6">
              <h2 className="text-[18px] font-semibold">{t("emailTitle")}</h2>
              <p className="mt-2 text-[15px] leading-7 text-fg-muted">{t("emailBody")}</p>
              <a
                href={`mailto:${env.SUPPORT_EMAIL}`}
                className="mt-5 inline-flex min-h-11 items-center text-[14px] font-medium text-primary hover:underline underline-offset-2"
              >
                {env.SUPPORT_EMAIL}
              </a>
            </Card>
          ) : null}
          <Card className="p-6 md:col-span-2">
            <h2 className="text-[18px] font-semibold">{t("securityTitle")}</h2>
            <p className="mt-2 max-w-3xl text-[15px] leading-7 text-fg-muted">{t("securityBody")}</p>
            <a
              href={SECURITY_ADVISORY}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex min-h-11 items-center text-[14px] font-medium text-primary hover:underline underline-offset-2"
            >
              {t("securityTitle")}
            </a>
          </Card>
        </div>
        <p className="mt-8 text-[13px] text-fg-subtle">{t("response")}</p>
      </main>
      <SiteFooter />
    </>
  );
}
