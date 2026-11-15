import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { GoogleSignIn, SignInForm } from "@/components/auth-forms";
import { googleSignInEnabled } from "@/lib/oauth";
import { AuthBrand } from "@/components/auth-brand";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-6 px-4">
      <AuthBrand locale={locale} />
      <h1 className="text-scale-lg font-semibold text-center">{t("signInTitle")}</h1>
      {error === "oauth" ? (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {t("errors.oauth")}
        </p>
      ) : null}
      {googleSignInEnabled() ? <GoogleSignIn locale={locale} /> : null}
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
