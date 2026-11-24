import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { releases } from "@deepcode/db";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { EmptyState } from "@/components/ui/primitives";
import { LocaleLink } from "@/components/locale-link";
import { pageMetadata } from "@/lib/seo";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.changelog" });
  return pageMetadata({ locale, path: "/changelog", title: t("title"), description: t("description") });
}

type ReleaseRow = typeof releases.$inferSelect;

function releaseTag(row: ReleaseRow): string | null {
  return /\/releases\/download\/([^/]+)\//.exec(row.url)?.[1] ?? null;
}

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("changelog");
  const rows = await db()
    .db.select()
    .from(releases)
    .where(and(eq(releases.channel, "stable"), isNotNull(releases.publishedAt)))
    .orderBy(desc(sql`${releases.publishedAt}`), desc(sql`${releases.version}`));

  const groups = new Map<string, { version: string; publishedAt: Date; platforms: Set<string>; tag: string | null }>();
  for (const row of rows) {
    const group = groups.get(row.version);
    if (group) {
      group.platforms.add(row.platform);
    } else {
      groups.set(row.version, {
        version: row.version,
        publishedAt: row.publishedAt ?? row.createdAt,
        platforms: new Set([row.platform]),
        tag: releaseTag(row),
      });
    }
  }
  const versions = [...groups.values()];
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-display-sm font-semibold">{t("title")}</h1>
        <p className="mt-3 text-[16px] leading-7 text-fg-muted">{t("sub")}</p>
        {versions.length === 0 ? (
          <div className="mt-8">
            <EmptyState title={t("title")} body={t("noReleases")} />
          </div>
        ) : (
          <ol className="mt-10 grid gap-4">
            {versions.map((release, index) => (
              <li key={release.version} className="rounded-lg border border-border bg-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[17px] font-semibold" dir="ltr">
                    {release.version}
                  </h2>
                  {index === 0 ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary-hover">{t("latest")}</span>
                  ) : null}
                </div>
                <p className="mt-2 text-[13px] text-fg-subtle tabular">
                  {release.publishedAt.toISOString().slice(0, 10)} ·{" "}
                  {[...release.platforms].map((p) => (p === "win" ? "Windows" : p === "mac" ? "macOS" : "Linux")).join(", ")}
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-[14px]">
                  {release.tag ? (
                    <a
                      href={`https://github.com/ALSRKAL/deepcode-desktop/releases/tag/${release.tag}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-primary hover:underline underline-offset-2"
                    >
                      {t("releaseNotes")}
                    </a>
                  ) : null}
                  <LocaleLink locale={locale} href="/download" className="inline-flex min-h-11 items-center text-fg-muted hover:text-fg">
                    {t("download")}
                  </LocaleLink>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

