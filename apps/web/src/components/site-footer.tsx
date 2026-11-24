import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { BrandMark, BrandWordmark } from "./brand";
import { LocaleSwitcher } from "./locale-switcher";

const GITHUB_DESKTOP = "https://github.com/ALSRKAL/deepcode-desktop";
const GITHUB_ACTIONS = "https://github.com/ALSRKAL/deepcode-studio/actions";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const n = await getTranslations("nav");
  const locale = await getLocale();
  const L = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const year = new Date().getFullYear();
  const linkClass = "inline-flex min-h-11 items-center text-[14px] text-fg-muted hover:text-fg";
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="grid content-start gap-3">
          <Link href={L("/")} className="inline-flex items-center gap-2" aria-label="DeepCode Studio">
            <BrandMark size={18} />
            <BrandWordmark className="font-semibold" />
          </Link>
          <p className="max-w-[22rem] text-[13px] leading-6 text-fg-subtle">{t("tagline")}</p>
        </div>
        <nav aria-label={n("product")} className="grid content-start gap-1">
          <p className="mb-1 text-[13px] font-medium text-fg">{n("product")}</p>
          <Link className={linkClass} href={L("/download")}>{n("download")}</Link>
          <Link className={linkClass} href={L("/pricing")}>{n("pricing")}</Link>
          <Link className={linkClass} href={L("/docs")}>{n("docs")}</Link>
          <Link className={linkClass} href={L("/changelog")}>{n("changelog")}</Link>
        </nav>
        <nav aria-label={t("resources")} className="grid content-start gap-1">
          <p className="mb-1 text-[13px] font-medium text-fg">{t("resources")}</p>
          <Link className={linkClass} href={L("/contact")}>{t("support")}</Link>
          <Link className={linkClass} href={L("/security")}>{t("security")}</Link>
          <a className={linkClass} href={GITHUB_ACTIONS} target="_blank" rel="noreferrer">
            {t("status")}
          </a>
          <a className={linkClass} href={GITHUB_DESKTOP} target="_blank" rel="noreferrer">
            {t("github")}
          </a>
        </nav>
        <nav aria-label={t("legal")} className="grid content-start gap-1">
          <p className="mb-1 text-[13px] font-medium text-fg">{t("legal")}</p>
          <Link className={linkClass} href={L("/legal/terms")}>{t("terms")}</Link>
          <Link className={linkClass} href={L("/legal/privacy")}>{t("privacy")}</Link>
          <Link className={linkClass} href={L("/legal/acceptable-use")}>{t("acceptableUse")}</Link>
          <Link className={linkClass} href={L("/legal/licenses")}>{t("licenses")}</Link>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-[13px] text-fg-subtle">
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <span className="tabular">© {year} DeepCode Studio</span>
          </div>
          <p>{t("basedOn")}</p>
        </div>
      </div>
    </footer>
  );
}
