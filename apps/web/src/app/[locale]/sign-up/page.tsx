import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { GoogleSignIn, SignUpForm } from "@/components/auth-forms";
import { googleSignInEnabled } from "@/lib/oauth";
import { AuthShell } from "@/components/auth-shell";
import { noindexMetadata } from "@/lib/seo";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "auth" });
  return noindexMetadata({ locale, path: "/sign-up", title: t("signUpTitle"), description: t("signUpTitle") });
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("auth");
  return (
    <AuthShell locale={locale}>
      <h1 className="text-scale-lg font-semibold text-center">{t("signUpTitle")}</h1>
      {env.TRIAL_ENABLED ? <p className="-mt-3 text-center text-[14px] text-fg-muted">{t("trialNote")}</p> : null}
      {googleSignInEnabled() ? <GoogleSignIn locale={locale} /> : null}
      <SignUpForm locale={locale} />
      <p className="text-center text-[14px] text-fg-muted">
        <LocaleLink locale={locale} href="/sign-in" className="text-primary hover:underline underline-offset-2">
          {t("toSignIn")}
        </LocaleLink>
      </p>
    </AuthShell>
  );
}
