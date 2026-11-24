"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavLinkItem {
  href: string;
  label: string;
}

/** Desktop navigation with a real active state (aria-current + the brand rule). */
export function NavLinks({ links, onNavigate }: { links: NavLinkItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex h-11 items-center px-3 text-[14px] transition-colors duration-200 ease-out after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full ${
              active
                ? "text-fg after:bg-primary"
                : "text-fg-muted hover:text-fg after:bg-transparent hover:after:bg-border-strong"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
