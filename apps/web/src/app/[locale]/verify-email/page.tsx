import { getTranslations } from "next-intl/server";
import { AuthBrand } from "@/components/auth-brand";

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("auth");
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-4 px-4 text-center">
      <AuthBrand locale={locale} />
      <h1 className="text-scale-lg font-semibold">{t("verifyTitle")}</h1>
      <p className="text-fg-muted text-[14px] leading-6">{t("verifyBody")}</p>
      {/* Local dev prints the verification URL to the console / Mailpit UI. */}
      <p className="text-fg-subtle text-[13px] tabular" dir="ltr">
        {new URL(`/${locale}/sign-in`, process.env.APP_URL ?? "http://localhost:3210").toString()}
      </p>
    </main>
  );
}
