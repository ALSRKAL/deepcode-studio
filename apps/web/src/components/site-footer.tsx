import { getLocale, getTranslations } from "next-intl/server";
import { BrandMark, BrandWordmark } from "./brand";
import { ButtonLink } from "./ui/button";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const locale = await getLocale();
  // Locale-prefixed hrefs: no extra redirect through the middleware per click.
  const L = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const n = await getTranslations("nav");
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border mt-24">
      <div className="mx-auto max-w-6xl px-4 py-10 grid gap-8 md:grid-cols-4 items-start text-[14px]">
        <div className="flex items-center gap-2 self-start">
          <BrandMark size={16} />
          <BrandWordmark className="font-semibold" />
        </div>
        <nav aria-label={n("product")} className="grid content-start gap-2 text-fg-muted">
          <p className="text-fg font-medium">{n("product")}</p>
          <ButtonLink href={L("/download")} variant="ghost" size="sm" className="!px-0 justify-start">
            {n("download")}
          </ButtonLink>
          <ButtonLink href={L("/pricing")} variant="ghost" size="sm" className="!px-0 justify-start">
            {n("pricing")}
          </ButtonLink>
          <ButtonLink href={L("/changelog")} variant="ghost" size="sm" className="!px-0 justify-start">
            {n("changelog")}
          </ButtonLink>
        </nav>
        <nav aria-label={t("legal")} className="grid content-start gap-2 text-fg-muted">
          <p className="text-fg font-medium">{t("legal")}</p>
          <ButtonLink href={L("/legal/terms")} variant="ghost" size="sm" className="!px-0 justify-start">
            {t("terms")}
          </ButtonLink>
          <ButtonLink href={L("/legal/privacy")} variant="ghost" size="sm" className="!px-0 justify-start">
            {t("privacy")}
          </ButtonLink>
          <ButtonLink href={L("/legal/acceptable-use")} variant="ghost" size="sm" className="!px-0 justify-start">
            {t("acceptableUse")}
          </ButtonLink>
          <ButtonLink href={L("/legal/licenses")} variant="ghost" size="sm" className="!px-0 justify-start">
            {t("licenses")}
          </ButtonLink>
        </nav>
        <div className="grid content-start gap-2 text-fg-muted">
          <p className="text-fg font-medium">{n("language")}</p>
          {/* ?locale= makes the middleware remember the choice in a cookie. */}
          <div className="flex gap-3">
            <a href={`/${locale}?locale=ar`} lang="ar" aria-current={locale === "ar" ? "true" : undefined} className="hover:text-fg aria-[current]:text-fg aria-[current]:font-medium">
              العربية
            </a>
            <a href={`/${locale}?locale=en`} lang="en" aria-current={locale === "en" ? "true" : undefined} className="hover:text-fg aria-[current]:text-fg aria-[current]:font-medium">
              English
            </a>
          </div>
          <p className="text-fg-subtle">{t("basedOn")}</p>
          <p className="text-fg-subtle tabular">© {year} DeepCode Studio</p>
        </div>
      </div>
    </footer>
  );
}
