import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { AuthBrand } from "@/components/auth-brand";
import { TwoFactorSignInForm } from "@/components/auth-forms";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-6 px-4">
      <AuthBrand locale={locale} />
      <h1 className="text-scale-lg font-semibold text-center">{t("twoFactorTitle")}</h1>
      <p className="text-center text-[14px] leading-6 text-fg-muted">{t("twoFactorBody")}</p>
      <TwoFactorSignInForm returnTo={returnTo} />
      <p className="text-center text-[14px] text-fg-muted">
        <LocaleLink locale={locale} href="/sign-in" className="text-primary hover:underline underline-offset-2">
          {t("twoFactorBack")}
        </LocaleLink>
      </p>
    </main>
  );
}
