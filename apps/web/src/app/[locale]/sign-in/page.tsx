import { getTranslations } from "next-intl/server";
import { LocaleLink } from "@/components/locale-link";
import { GoogleSignIn, SignInForm } from "@/components/auth-forms";
import { googleSignInEnabled } from "@/lib/oauth";
import { AuthShell } from "@/components/auth-shell";
import { noindexMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "auth" });
  return noindexMetadata({ locale, path: "/sign-in", title: t("signInTitle"), description: t("signInTitle") });
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { locale } = await params;
  const { error, reset } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <AuthShell locale={locale}>
      <h1 className="text-scale-lg font-semibold text-center">{t("signInTitle")}</h1>
      {reset ? (
        <p role="status" className="rounded-sm border border-success/40 bg-success/5 px-3 py-2 text-[13px] text-success">
          {t("resetSuccess")}
        </p>
      ) : null}
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
    </AuthShell>
  );
}
