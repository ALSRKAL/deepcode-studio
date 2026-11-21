import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { releases } from "@deepcode/db";
import { db } from "@/lib/db";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DownloadDetector } from "@/components/download-detector";
import { Card, Num, EmptyState } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { CopyButton } from "@/components/ui/client";
import { env } from "@/lib/env";

/** Download centre (docs/plan/03 §3.2): OS detection + full matrix from releases. */
export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("download");
  const rows = await db()
    .db.select()
    .from(releases)
    .where(and(eq(releases.channel, "stable"), isNotNull(releases.publishedAt)))
    .orderBy(sql`${releases.publishedAt} desc`);

  const name = (p: string) => (p === "win" ? "Windows" : p === "mac" ? "macOS" : "Linux");
  const latestVersion = rows[0]?.version;
  const origin = env.APP_URL.replace(/\/$/, "");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
        <p className="mt-2 text-fg-muted text-[15px]">{t("sub")}</p>

        <Card className="mt-8 p-5">
          <h2 className="text-scale-md font-semibold">{t("installTitle")}</h2>
          <p className="mt-1 text-[14px] text-fg-muted">{t("installSub")}</p>
          {[
            { label: t("installWin"), cmd: `irm ${origin}/install.ps1 | iex` },
            { label: t("installUnix"), cmd: `curl -fsSL ${origin}/install.sh | sh` },
          ].map(({ label, cmd }) => (
            <div key={cmd} className="mt-4">
              <div className="text-[13px] text-fg-subtle">{label}</div>
              <div className="mt-1 flex items-center gap-2">
                <code dir="ltr" tabIndex={0} aria-label={label} className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px]">
                  {cmd}
                </code>
                <CopyButton value={cmd} label={t("copy")} />
              </div>
            </div>
          ))}
          <p className="mt-4 text-[12px] text-fg-subtle">{t("installNote")}</p>
        </Card>

        <div className="mt-8">
          <DownloadDetector
            builds={rows.map((r) => ({
              platform: r.platform,
              arch: r.arch,
              fileKind: r.fileKind,
              version: r.version,
              url: r.url,
              sizeBytes: Number(r.sizeBytes),
            }))}
          />
        </div>

        <h2 className="mt-12 text-scale-md font-semibold">{t("matrix")}</h2>
        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState title={t("matrix")} body={t("noReleases")} />
          </div>
        ) : (
          <Card className="mt-4 overflow-x-auto" scrollLabel={t("matrix")}>
            <table className="w-full text-[14px]">
              <thead className="text-fg-subtle text-[13px]">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">OS</th>
                  <th className="px-4 py-2 text-start font-medium">{t("version")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("size")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("date")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("sha256")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <a href={r.url} className="text-primary hover:underline underline-offset-2">
                        {name(r.platform)} {r.arch} <LtrIsland className="text-[12px] text-fg-muted">.{r.fileKind}</LtrIsland>
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <Num>{r.version}</Num>
                    </td>
                    <td className="px-4 py-2">
                      <Num>{(Number(r.sizeBytes) / 1024 / 1024).toFixed(1)} MB</Num>
                    </td>
                    <td className="px-4 py-2">
                      <Num>{(r.publishedAt ?? r.createdAt).toISOString().slice(0, 10)}</Num>
                    </td>
                    <td className="px-4 py-2">
                      <Num className="text-[11px]">{r.sha256.slice(0, 16)}…</Num>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        {latestVersion ? (
          <p className="mt-3 text-[13px] text-fg-subtle tabular font-mono" dir="ltr">
            latest: v{latestVersion} · channel: stable
          </p>
        ) : null}
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
