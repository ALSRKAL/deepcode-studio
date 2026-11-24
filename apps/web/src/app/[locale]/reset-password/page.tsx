import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/auth-forms";
import { LocaleLink } from "@/components/locale-link";
import { noindexMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "auth" });
  return noindexMetadata({
    locale,
    path: "/reset-password",
    title: t("resetTitle"),
    description: t("resetBody"),
  });
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { token, error } = await searchParams;
  const t = await getTranslations("auth");
  const valid = Boolean(token) && !error;
  return (
    <AuthShell locale={locale}>
      <h1 className="text-scale-lg font-semibold text-center">{t("resetTitle")}</h1>
      {valid ? (
        <>
          <p className="text-center text-[14px] leading-6 text-fg-muted">{t("resetBody")}</p>
          <ResetPasswordForm token={token!} />
        </>
      ) : (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {t("resetInvalid")}
        </p>
      )}
      <div className="grid gap-2 text-center text-[14px] text-fg-muted">
        <LocaleLink locale={locale} href="/forgot-password" className="hover:text-fg">
          {t("forgotTitle")}
        </LocaleLink>
        <LocaleLink locale={locale} href="/sign-in" className="text-primary hover:underline underline-offset-2">
          {t("backToSignIn")}
        </LocaleLink>
      </div>
    </AuthShell>
  );
}
