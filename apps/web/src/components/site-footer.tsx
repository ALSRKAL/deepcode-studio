import { getTranslations } from "next-intl/server";
import { BrandMark, BrandWordmark } from "./brand";
import { ButtonLink } from "./ui/button";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const n = await getTranslations("nav");
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border mt-24">
      <div className="mx-auto max-w-6xl px-4 py-10 grid gap-8 md:grid-cols-4 text-[14px]">
        <div className="flex items-center gap-2">
          <BrandMark size={16} />
          <BrandWordmark className="font-semibold" />
        </div>
        <nav aria-label={n("product")} className="grid gap-2 text-fg-muted">
          <p className="text-fg font-medium">{n("product")}</p>
          <ButtonLink href="/download" variant="ghost" size="sm" className="!px-0 justify-start">
            {n("download")}
          </ButtonLink>
          <ButtonLink href="/pricing" variant="ghost" size="sm" className="!px-0 justify-start">
            {n("pricing")}
          </ButtonLink>
          <ButtonLink href="/changelog" variant="ghost" size="sm" className="!px-0 justify-start">
            {n("changelog")}
          </ButtonLink>
        </nav>
        <nav aria-label={t("legal")} className="grid gap-2 text-fg-muted">
          <p className="text-fg font-medium">{t("legal")}</p>
          <ButtonLink href="/legal/terms" variant="ghost" size="sm" className="!px-0 justify-start">
            {t("terms")}
          </ButtonLink>
          <ButtonLink href="/legal/privacy" variant="ghost" size="sm" className="!px-0 justify-start">
            {t("privacy")}
          </ButtonLink>
          <ButtonLink href="/legal/acceptable-use" variant="ghost" size="sm" className="!px-0 justify-start">
            {t("acceptableUse")}
          </ButtonLink>
          <ButtonLink href="/legal/licenses" variant="ghost" size="sm" className="!px-0 justify-start">
            {t("licenses")}
          </ButtonLink>
        </nav>
        <div className="grid gap-2 text-fg-muted">
          <p className="text-fg font-medium">{n("language")}</p>
          <p className="text-fg-subtle">{t("basedOn")}</p>
          <p className="text-fg-subtle tabular">© {year} DeepCode Studio</p>
        </div>
      </div>
    </footer>
  );
}
