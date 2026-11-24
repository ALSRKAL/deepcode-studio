import Link from "next/link";
import { SignedInSwitch } from "@/components/signed-in";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ButtonLink } from "@/components/ui/button";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { MobileNav } from "@/components/mobile-nav";
import { NavLinks, type NavLinkItem } from "@/components/nav-links";

/**
 * `signedIn` known on the server (dynamic pages) renders that state; left undefined
 * (cached public pages) the browser decides via SignedInSwitch.
 */
export async function SiteHeader({ signedIn }: { signedIn?: boolean }) {
  const t = await getTranslations("nav");
  const locale = await getLocale();
  // Locale-prefixed hrefs: no extra redirect through the middleware per click.
  const L = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const links: NavLinkItem[] = [
    { href: L("/pricing"), label: t("pricing") },
    { href: L("/download"), label: t("download") },
    { href: L("/docs"), label: t("docs") },
    { href: L("/changelog"), label: t("changelog") },
  ];
  const dashboardLink = (
    <ButtonLink href={L("/dashboard")} variant="secondary" size="sm">
      {t("dashboard")}
    </ButtonLink>
  );
  const signInLinks = (
    <>
      <ButtonLink href={L("/sign-in")} variant="ghost" size="sm" className="whitespace-nowrap">
        {t("signIn")}
      </ButtonLink>
      <ButtonLink href={L("/sign-up")} variant="primary" size="sm" className="whitespace-nowrap">
        {t("signUp")}
      </ButtonLink>
    </>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-2 focus:text-[14px] focus:font-medium focus:text-fg focus:shadow-float"
      >
        {t("skipToContent")}
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link href={L("/")} className="flex shrink-0 items-center gap-2" aria-label="DeepCode Studio">
          <BrandMark size={22} />
          <BrandWordmark className="hidden whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] sm:inline" />
        </Link>
        <nav aria-label={t("primary")} className="hidden items-center gap-1 md:flex">
          <NavLinks links={links} />
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LocaleSwitcher />
          <div className="hidden items-center gap-2 md:flex">
            {signedIn === undefined ? (
              <SignedInSwitch signedIn={dashboardLink} signedOut={signInLinks} />
            ) : signedIn ? (
              dashboardLink
            ) : (
              signInLinks
            )}
          </div>
          <MobileNav links={links} locale={locale} />
        </div>
      </div>
    </header>
  );
}
