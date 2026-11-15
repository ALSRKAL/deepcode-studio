import { getTranslations } from "next-intl/server";
import { currentUser } from "@/lib/guards";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Card } from "@/components/ui/primitives";

/**
 * Legal pages (docs/plan/04 Phase 2b): clearly-marked placeholder text for the
 * owner. Never presented as final terms (docs/plan PROMPT §4 Step B).
 */
const SLUGS = ["terms", "privacy", "acceptable-use", "licenses"] as const;
type Slug = (typeof SLUGS)[number];

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("legal");
  if (!SLUGS.includes(slug as Slug)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-fg-muted">404</p>
      </main>
    );
  }
  const user = await currentUser();
  const titleKey = slug === "acceptable-use" ? "acceptableUse" : slug;
  const title = t.has(titleKey) ? t(titleKey) : slug;

  return (
    <>
      <SiteHeader signedIn={user !== null} />
      <main className="mx-auto max-w-3xl px-4 py-16 grid gap-6">
        <h1 className="text-scale-lg font-semibold">{title}</h1>
        <Card className="border-warning/40 p-5">
          <p className="font-medium text-warning">{t("placeholderTitle")}</p>
          <p className="mt-1 text-[14px] leading-7 text-fg-muted">{t("placeholderBody")}</p>
        </Card>
        <div className="rounded-lg border border-border bg-surface p-6 text-[14px] leading-7 text-fg-muted">
          {slug === "licenses" ? <p>{t("licensesBody")}</p> : <p>{t("placeholderBody")}</p>}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
