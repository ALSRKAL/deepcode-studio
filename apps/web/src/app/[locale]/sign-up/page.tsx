import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { SignUpForm } from "@/components/auth-forms";
import { AuthBrand } from "@/components/auth-brand";

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-6 px-4">
      <AuthBrand locale={locale} />
      <h1 className="text-scale-lg font-semibold text-center">{t("signUpTitle")}</h1>
      <SignUpForm />
      <p className="text-center text-[14px] text-fg-muted">
        <LocaleLink locale={locale} href="/sign-in" className="text-primary hover:underline underline-offset-2">
          {t("toSignIn")}
        </LocaleLink>
      </p>
    </main>
  );
}
