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
import { LocaleLink } from "@/components/locale-link";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = raw === "en" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "meta.download" });
  return pageMetadata({ locale, path: "/download", title: t("title"), description: t("description") });
}

/** Download centre (docs/plan/03 §3.2): server-rendered choices + full matrix. */
export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("download");
  const common = await getTranslations("common");
  const rows = await db()
    .db.select()
    .from(releases)
    .where(and(eq(releases.channel, "stable"), isNotNull(releases.publishedAt)))
    .orderBy(sql`${releases.publishedAt} desc`);

  const name = (platform: string) => (platform === "win" ? t("windows") : platform === "mac" ? t("macos") : t("linux"));
  const latestVersion = rows[0]?.version;
  const origin = siteUrl();

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-display-sm font-semibold">{t("title")}</h1>
            <p className="mt-2 text-[15px] text-fg-muted">{t("sub")}</p>
          </div>
          <LocaleLink locale={locale} href="/changelog" className="inline-flex min-h-11 items-center text-[14px] font-medium text-primary hover:underline underline-offset-2">
            {t("releaseNotes")}
          </LocaleLink>
        </div>

        <div className="mt-8">
          <DownloadDetector
            builds={rows.map((row) => ({
              platform: row.platform,
              arch: row.arch,
              fileKind: row.fileKind,
              version: row.version,
              url: row.url,
              sizeBytes: Number(row.sizeBytes),
            }))}
          />
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-[16px] font-semibold">{t("requirementsTitle")}</h2>
            <p className="mt-2 text-[14px] leading-7 text-fg-muted">{t("requirementsBody")}</p>
          </Card>
          <Card className="p-5">
            <h2 className="text-[16px] font-semibold">{t("unsignedTitle")}</h2>
            <p className="mt-2 text-[14px] leading-7 text-fg-muted">{t("unsignedBody")}</p>
          </Card>
        </div>

        <Card className="mt-4 p-5">
          <h2 className="text-[16px] font-semibold">{t("installTitle")}</h2>
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
                <CopyButton value={cmd} label={t("copy")} copiedLabel={common("copied")} />
              </div>
            </div>
          ))}
          <p className="mt-4 text-[12px] text-fg-subtle">{t("installNote")}</p>
        </Card>

        <h2 id="builds" className="mt-12 scroll-mt-24 text-scale-md font-semibold">{t("matrix")}</h2>
        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState title={t("matrix")} body={t("noReleases")} />
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 md:hidden">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border border-border bg-surface p-4">
                  <a href={row.url} className="font-medium text-primary hover:underline underline-offset-2">
                    {name(row.platform)} {row.arch} <LtrIsland className="text-[12px] text-fg-muted">.{row.fileKind}</LtrIsland>
                  </a>
                  <p className="mt-1 text-[12px] text-fg-subtle tabular" dir="ltr">
                    {row.version} · {(Number(row.sizeBytes) / 1024 / 1024).toFixed(1)} MB · {(row.publishedAt ?? row.createdAt).toISOString().slice(0, 10)}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <LtrIsland className="min-w-0 break-all font-mono text-[10px] text-fg-muted">{row.sha256}</LtrIsland>
                    <CopyButton value={row.sha256} label={t("copyChecksum")} copiedLabel={common("copied")} />
                  </div>
                </div>
              ))}
            </div>
            <Card className="mt-4 hidden overflow-x-auto md:block" scrollLabel={t("matrix")}>
            <table className="w-full min-w-[760px] text-[14px]">
              <caption className="sr-only">{t("matrix")}</caption>
              <thead className="text-[13px] text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("os")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("version")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("size")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("date")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("sha256")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <a href={row.url} className="text-primary hover:underline underline-offset-2">
                        {name(row.platform)} {row.arch} <LtrIsland className="text-[12px] text-fg-muted">.{row.fileKind}</LtrIsland>
                      </a>
                    </td>
                    <td className="px-4 py-3"><Num>{row.version}</Num></td>
                    <td className="px-4 py-3"><Num>{(Number(row.sizeBytes) / 1024 / 1024).toFixed(1)} MB</Num></td>
                    <td className="px-4 py-3"><Num>{(row.publishedAt ?? row.createdAt).toISOString().slice(0, 10)}</Num></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <LtrIsland className="max-w-[14rem] truncate font-mono text-[11px] text-fg-muted">{row.sha256}</LtrIsland>
                        <CopyButton value={row.sha256} label={t("copyChecksum")} copiedLabel={common("copied")} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </Card>
          </>
        )}
        <div className="mt-4 grid gap-2 text-[13px] text-fg-muted">
          <p><span className="font-medium text-fg">{t("verifyChecksum")}:</span> {t("verifyBody")}</p>
          {latestVersion ? (
            <p className="tabular font-mono" dir="ltr">
              {t("latest")}: v{latestVersion} · {t("channelStable")}
            </p>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

// Rendered per request so the CSP nonce on Next's scripts stays valid.
