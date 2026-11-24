import { getTranslations } from "next-intl/server";
import { AuthBrand } from "./auth-brand";
import { LocaleLink } from "./locale-link";
import { LocaleSwitcher } from "./locale-switcher";

/** Shared auth shell: brand, language switch and legal links on every account page. */
export async function AuthShell({ locale, children }: { locale: string; children: React.ReactNode }) {
  const t = await getTranslations("footer");
  return (
    <main id="main" className="mx-auto grid min-h-dvh w-full max-w-md content-start gap-6 px-4 py-8 sm:place-content-center">
      <div className="flex items-center justify-between gap-4">
        <AuthBrand locale={locale} />
        <LocaleSwitcher />
      </div>
      {children}
      <nav aria-label={t("legal")} className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[13px] text-fg-subtle">
        <LocaleLink locale={locale} href="/legal/terms" className="hover:text-fg">
          {t("terms")}
        </LocaleLink>
        <LocaleLink locale={locale} href="/legal/privacy" className="hover:text-fg">
          {t("privacy")}
        </LocaleLink>
      </nav>
    </main>
  );
}
