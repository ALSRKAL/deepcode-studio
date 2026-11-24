import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/guards";
import { LocaleLink } from "@/components/locale-link";
import { BrandMark } from "@/components/brand";
import { SignOutButton } from "@/components/dashboard-shell";

/** Admin layout (docs/plan/03 §6): separate navigation, mandatory 2FA via guard. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin();
  const t = await getTranslations("admin");
  const items = [
    { href: "/admin", label: t("overview") },
    { href: "/admin/providers", label: t("providers") },
    { href: "/admin/pool", label: t("pool") },
    { href: "/admin/models", label: t("models") },
    { href: "/admin/users", label: t("users") },
    { href: "/admin/payments", label: t("payments") },
    { href: "/admin/plans", label: t("plans") },
    { href: "/admin/marketplace", label: t("marketplace") },
    { href: "/admin/releases", label: t("releases") },
    { href: "/admin/audit", label: t("audit") },
  ];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <LocaleLink locale={locale} href="/admin" className="flex shrink-0 items-center gap-2 font-semibold text-[15px]">
            <BrandMark size={16} />
            {t("title")}
          </LocaleLink>
          <nav aria-label={t("title")} className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {items.map((i) => (
              <LocaleLink
                key={i.href}
                locale={locale}
                href={i.href}
                className="whitespace-nowrap px-3 py-2 text-[14px] text-fg-muted hover:text-fg transition-colors duration-200 ease-out"
              >
                {i.label}
              </LocaleLink>
            ))}
          </nav>
          <div className="ms-auto shrink-0">
            <SignOutButton label={t("title")} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}

// Per-user pages: never cached, whatever the parent layout allows (see [locale]/layout.tsx).
export const dynamic = "force-dynamic";
