import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth-shell";
import { ResendVerificationForm } from "@/components/auth-forms";
import { LocaleLink } from "@/components/locale-link";
import { noindexMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "auth" });
  return noindexMetadata({
    locale,
    path: "/verify-email",
    title: t("verifyTitle"),
    description: t("verifyBody"),
  });
}

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const { locale } = await params;
  const { sent } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <AuthShell locale={locale}>
      <h1 className="text-scale-lg font-semibold text-center">{t("verifyTitle")}</h1>
      <p className="text-center text-[14px] leading-6 text-fg-muted">{t("verifyBody")}</p>
      {sent ? (
        <p role="status" className="rounded-sm border border-success/40 bg-success/5 px-3 py-2 text-[13px] text-success">
          {t("verifyResendSent")}
        </p>
      ) : null}
      <div className="grid gap-3">
        <p className="text-[13px] text-fg-subtle">{t("verifyHelp")}</p>
        <ResendVerificationForm />
      </div>
      <LocaleLink locale={locale} href="/sign-in" className="text-center text-[14px] text-primary hover:underline underline-offset-2">
        {t("signInInstead")}
      </LocaleLink>
    </AuthShell>
  );
}
