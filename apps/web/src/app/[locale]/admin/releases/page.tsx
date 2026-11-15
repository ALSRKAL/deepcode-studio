import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { releases } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Badge, Num } from "@/components/ui/primitives";
import { ImportReleaseForm, ReleaseForms } from "@/components/releases-client";
import { LtrIsland } from "@/components/ltr-island";

/** Releases admin (docs/plan/03 §6.5): register builds, promote preview → stable. */
export default async function AdminReleasesPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  const rows = await db().db.select().from(releases).orderBy(desc(releases.createdAt));

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("releases")}</h1>
      <ImportReleaseForm />
      <ReleaseForms />
      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("version")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("channel")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("platform")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("arch")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("size")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("sha")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px]">{r.version}</LtrIsland>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={r.channel === "stable" ? "success" : "warning"}>{r.channel}</Badge>
                </td>
                <td className="px-4 py-2">
                  {r.platform}-{r.arch} .{r.fileKind}
                </td>
                <td className="px-4 py-2">
                  <Num>{(Number(r.sizeBytes) / 1024 / 1024).toFixed(1)} MB</Num>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={r.publishedAt ? "success" : "warning"}>{r.publishedAt ? "published" : "draft"}</Badge>
                </td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[11px] text-fg-muted">{r.sha256.slice(0, 12)}…</LtrIsland>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {rows.length === 0 ? <p className="text-fg-muted text-[14px]">{t("noReleases")}</p> : null}
    </div>
  );
}
