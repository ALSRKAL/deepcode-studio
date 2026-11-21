import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { EmptyState } from "@/components/ui/primitives";

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("nav");
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 grid gap-6">
        <h1 className="text-scale-lg font-semibold">{t("changelog")}</h1>
        <EmptyState title={t("changelog")} body="Releases appear here once the first public build is published." />
      </main>
      <SiteFooter />
    </>
  );
}

// Public, identical for every visitor: rendered on first request, then served from
// cache and refreshed at most every 60 s (2026-11-21: rendering per visit gave 11 req/s
// at 10 s latency under load). The empty list enables that runtime cache without
// prerendering at build time (the image build has no database).
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}
