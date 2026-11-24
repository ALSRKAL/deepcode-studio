"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SignedInSwitch } from "./signed-in";
import { NavLinks, type NavLinkItem } from "./nav-links";

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Phone navigation: a real disclosure dialog, not a CSS-hidden desktop nav.
 * Escape, backdrop, focus trap and focus return are handled here.
 */
export function MobileNav({ links, locale }: { links: NavLinkItem[]; locale: string }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const frame = requestAnimationFrame(() => focusables()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        aria-label={t("menu")}
        className="inline-flex size-11 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <MenuIcon />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-ink/40" onClick={() => setOpen(false)}>
          <div
            ref={panelRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label={t("menu")}
            className="absolute inset-y-0 end-0 flex w-[min(20rem,88vw)] flex-col gap-6 bg-surface p-5 shadow-float"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold">{t("menu")}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("closeMenu")}
                className="inline-flex size-11 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <CloseIcon />
              </button>
            </div>
            <nav aria-label={t("menu")} className="grid gap-1">
              <NavLinks links={links} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="mt-auto grid gap-2 border-t border-border pt-4">
              <SignedInSwitch
                signedIn={
                  <Link
                    href={`/${locale}/dashboard`}
                    onClick={() => setOpen(false)}
                    className="inline-flex h-11 items-center justify-center rounded-sm bg-primary px-4 text-[14px] font-medium text-primary-fg"
                  >
                    {t("dashboard")}
                  </Link>
                }
                signedOut={
                  <>
                    <Link
                      href={`/${locale}/sign-in`}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-11 items-center justify-center rounded-sm border border-border px-4 text-[14px] font-medium text-fg hover:bg-surface-2"
                    >
                      {t("signIn")}
                    </Link>
                    <Link
                      href={`/${locale}/sign-up`}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-11 items-center justify-center rounded-sm bg-primary px-4 text-[14px] font-medium text-primary-fg"
                    >
                      {t("signUp")}
                    </Link>
                  </>
                }
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
