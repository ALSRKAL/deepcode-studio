import { getTranslations } from "next-intl/server";
import { currentUser } from "@/lib/guards";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { EmptyState } from "@/components/ui/primitives";

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  const t = await getTranslations("nav");
  const user = await currentUser();
  return (
    <>
      <SiteHeader signedIn={user !== null} />
      <main className="mx-auto max-w-3xl px-4 py-16 grid gap-6">
        <h1 className="text-scale-lg font-semibold">{t("changelog")}</h1>
        <EmptyState title={t("changelog")} body="Releases appear here once the first public build is published." />
      </main>
      <SiteFooter />
    </>
  );
}
