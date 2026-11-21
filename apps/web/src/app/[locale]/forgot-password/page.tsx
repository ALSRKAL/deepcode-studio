import { getTranslations } from "next-intl/server";
import { ForgotForm } from "@/components/auth-forms";
import { AuthBrand } from "@/components/auth-brand";

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
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-6 px-4">
      <AuthBrand locale={locale} />
      <h1 className="text-scale-lg font-semibold text-center">{t("forgotTitle")}</h1>
      {sent ? (
        <p role="status" className="rounded-sm border border-success/40 bg-success/5 px-3 py-2 text-[13px] text-success">
          {t("forgotSent")}
        </p>
      ) : (
        <ForgotForm />
      )}
    </main>
  );
}

// Per-user / token pages: never cached (see [locale]/layout.tsx).
export const dynamic = "force-dynamic";
