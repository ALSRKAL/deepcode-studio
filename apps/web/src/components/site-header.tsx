import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ButtonLink } from "@/components/ui/button";
import { BrandMark, BrandWordmark } from "@/components/brand";

/** Site header — the 1px cyan rule is the active-state indicator (§1.6 signature). */
export async function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations("nav");
  const links = [
    { href: "/pricing", label: t("pricing") },
    { href: "/download", label: t("download") },
    { href: "/docs", label: t("docs") },
    { href: "/changelog", label: t("changelog") },
  ];
  return (
    <header className="border-b border-border bg-bg/95 sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2" aria-label="DeepCode Studio">
          <BrandMark size={22} />
          <BrandWordmark className="hidden whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] sm:inline" />
        </Link>
        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative px-3 py-2 text-[14px] text-fg-muted hover:text-fg transition-colors duration-200 ease-out"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LocaleSwitcher />
          {signedIn ? (
            <ButtonLink href="/dashboard" variant="secondary" size="sm">
              {t("dashboard")}
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/sign-in" variant="ghost" size="sm" className="max-sm:hidden whitespace-nowrap">
                {t("signIn")}
              </ButtonLink>
              <ButtonLink href="/sign-up" variant="primary" size="sm" className="whitespace-nowrap">
                {t("signUp")}
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
