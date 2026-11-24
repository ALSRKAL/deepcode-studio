import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { AuthShell } from "@/components/auth-shell";
import { TwoFactorSignInForm } from "@/components/auth-forms";
import { noindexMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "auth" });
  return noindexMetadata({ locale, path: "/sign-in/two-factor", title: t("twoFactorTitle"), description: t("twoFactorBody") });
}

/** Second sign-in step for password accounts with 2FA (authenticator or backup code). */
export default async function TwoFactorSignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { locale } = await params;
  const { returnTo } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <AuthShell locale={locale}>
      <h1 className="text-scale-lg font-semibold text-center">{t("twoFactorTitle")}</h1>
      <p className="text-center text-[14px] leading-6 text-fg-muted">{t("twoFactorBody")}</p>
      <TwoFactorSignInForm returnTo={returnTo} />
      <p className="text-center text-[14px] text-fg-muted">
        <LocaleLink locale={locale} href="/sign-in" className="text-primary hover:underline underline-offset-2">
          {t("twoFactorBack")}
        </LocaleLink>
      </p>
    </AuthShell>
  );
}
