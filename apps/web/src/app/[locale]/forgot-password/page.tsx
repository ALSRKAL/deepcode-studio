import { getTranslations } from "next-intl/server";
import { ForgotForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/auth-shell";
import { LocaleLink } from "@/components/locale-link";
import { noindexMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "auth" });
  return noindexMetadata({ locale, path: "/forgot-password", title: t("forgotTitle"), description: t("forgotBody") });
}

export default async function ForgotPasswordPage({
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
      <h1 className="text-scale-lg font-semibold text-center">{t("forgotTitle")}</h1>
      <p className="text-center text-[14px] leading-6 text-fg-muted">{t("forgotBody")}</p>
      {sent ? (
        <p role="status" className="rounded-sm border border-success/40 bg-success/5 px-3 py-2 text-[13px] text-success">
          {t("forgotSent")}
        </p>
      ) : (
        <ForgotForm />
      )}
      <LocaleLink locale={locale} href="/sign-in" className="text-center text-[14px] text-primary hover:underline underline-offset-2">
        {t("backToSignIn")}
      </LocaleLink>
    </AuthShell>
  );
}

// Per-user / token pages: never cached (see [locale]/layout.tsx).
export const dynamic = "force-dynamic";
