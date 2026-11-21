import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/guards";
import { LocaleLink } from "@/components/locale-link";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { SignOutButton } from "@/components/dashboard-shell";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireUser();
  const t = await getTranslations("dashboard");
  const n = await getTranslations("nav");
  const items = [
    { href: "/dashboard", label: t("overview") },
    { href: "/dashboard/usage", label: t("usage") },
    { href: "/dashboard/keys", label: t("keys") },
    { href: "/dashboard/devices", label: t("devices") },
    { href: "/dashboard/billing", label: t("billing") },
    { href: "/dashboard/settings", label: t("settings") },
  ];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <LocaleLink locale={locale} href="/" className="flex shrink-0 items-center gap-2">
            <BrandMark size={20} />
            <BrandWordmark className="hidden whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] sm:inline" />
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
            <SignOutButton label={n("signOut")} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

// Per-user pages: never cached, whatever the parent layout allows (see [locale]/layout.tsx).
export const dynamic = "force-dynamic";
