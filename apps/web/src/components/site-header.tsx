import Link from "next/link";
import { SignedInSwitch } from "@/components/signed-in";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ButtonLink } from "@/components/ui/button";
import { BrandMark, BrandWordmark } from "@/components/brand";

/** Site header — the 1px cyan rule is the active-state indicator (§1.6 signature). */
/**
 * `signedIn` known on the server (dynamic pages) renders that state; left undefined
 * (cached public pages) the browser decides via SignedInSwitch.
 */
export async function SiteHeader({ signedIn }: { signedIn?: boolean }) {
  const t = await getTranslations("nav");
  const locale = await getLocale();
  // Locale-prefixed hrefs: no extra redirect through the middleware per click.
  const L = (path: string) => `/${locale}${path === "/" ? "" : path}`;
  const links = [
    { href: "/pricing", label: t("pricing") },
    { href: "/download", label: t("download") },
    { href: "/docs", label: t("docs") },
    { href: "/changelog", label: t("changelog") },
  ];
  return (
    <header className="border-b border-border bg-bg/95 sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href={L("/")} className="flex items-center gap-2" aria-label="DeepCode Studio">
          <BrandMark size={22} />
          <BrandWordmark className="hidden whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] sm:inline" />
        </Link>
        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={L(l.href)}
              className="relative px-3 py-2 text-[14px] text-fg-muted hover:text-fg transition-colors duration-200 ease-out"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LocaleSwitcher />
          {(() => {
            const dashboardLink = (
              <ButtonLink href={L("/dashboard")} variant="secondary" size="sm">
                {t("dashboard")}
              </ButtonLink>
            );
            const signInLinks = (
              <>
                <ButtonLink href={L("/sign-in")} variant="ghost" size="sm" className="max-sm:hidden whitespace-nowrap">
                  {t("signIn")}
                </ButtonLink>
                <ButtonLink href={L("/sign-up")} variant="primary" size="sm" className="whitespace-nowrap">
                  {t("signUp")}
                </ButtonLink>
              </>
            );
            if (signedIn === undefined) return <SignedInSwitch signedIn={dashboardLink} signedOut={signInLinks} />;
            return signedIn ? dashboardLink : signInLinks;
          })()}
        </div>
      </div>
    </header>
  );
}
