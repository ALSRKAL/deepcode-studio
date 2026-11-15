import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { SignInForm } from "@/components/auth-forms";
import { AuthBrand } from "@/components/auth-brand";

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-6 px-4">
      <AuthBrand locale={locale} />
      <h1 className="text-scale-lg font-semibold text-center">{t("signInTitle")}</h1>
      <SignInForm />
      <div className="text-center text-[14px] text-fg-muted grid gap-2">
        <LocaleLink locale={locale} href="/forgot-password" className="hover:text-fg">
          {t("forgot")}
        </LocaleLink>
        <LocaleLink locale={locale} href="/sign-up" className="text-primary hover:underline underline-offset-2">
          {t("toSignUp")}
        </LocaleLink>
      </div>
    </main>
  );
}
