import { getTranslations } from "next-intl/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { releases } from "@deepcode/db";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/guards";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DownloadDetector } from "@/components/download-detector";
import { Card, Num, EmptyState } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";

/** Download centre (docs/plan/03 §3.2): OS detection + full matrix from releases. */
export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  const t = await getTranslations("download");
  const user = await currentUser();
  const rows = await db()
    .db.select()
    .from(releases)
    .where(and(eq(releases.channel, "stable"), isNotNull(releases.publishedAt)))
    .orderBy(sql`${releases.publishedAt} desc`);

  const name = (p: string) => (p === "win" ? "Windows" : p === "mac" ? "macOS" : "Linux");
  const latestVersion = rows[0]?.version;

  return (
    <>
      <SiteHeader signedIn={user !== null} />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
        <p className="mt-2 text-fg-muted text-[15px]">{t("sub")}</p>
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
          <Card className="mt-4 overflow-x-auto">
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
