import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { marketplaceMcpPresets, marketplaceSkills } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Badge } from "@/components/ui/primitives";
import { MarketplaceForms } from "@/components/marketplace-client";
import { LtrIsland } from "@/components/ltr-island";

/** Marketplace publisher (docs/plan/03 §6.4): skills upload + MCP presets. */
export default async function AdminMarketplacePage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  const skills = await db().db.select().from(marketplaceSkills).orderBy(desc(marketplaceSkills.createdAt));
  const presets = await db().db.select().from(marketplaceMcpPresets).orderBy(desc(marketplaceMcpPresets.createdAt));

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("marketplace")}</h1>

      <MarketplaceForms />

      <Card className="overflow-x-auto">
        <p className="px-4 pt-4 text-fg-subtle text-[13px]">{t("marketplaceSkills")}</p>
        <table className="mt-2 w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">slug</th>
              <th className="px-4 py-2 text-start font-medium">{t("version")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("minTier")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
              <th className="px-4 py-2 text-start font-medium">sha256</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px]">{s.slug}</LtrIsland>
                  {s.hasExecutables ? <Badge tone="warning">executables</Badge> : null}
                </td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px] text-fg-muted">{s.version}</LtrIsland>
                </td>
                <td className="px-4 py-2">{s.minTier}</td>
                <td className="px-4 py-2">
                  <Badge tone={s.status === "published" ? "success" : s.status === "draft" ? "warning" : "neutral"}>
                    {s.status}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[11px] text-fg-muted">{s.sha256.slice(0, 12)}…</LtrIsland>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <p className="px-4 pt-4 text-fg-subtle text-[13px]">{t("marketplaceMcp")}</p>
        <table className="mt-2 w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">slug</th>
              <th className="px-4 py-2 text-start font-medium">{t("mcpTransport")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("version")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {presets.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px]">{p.slug}</LtrIsland>
                </td>
                <td className="px-4 py-2">{p.transport}</td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px] text-fg-muted">{p.version}</LtrIsland>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={p.status === "published" ? "success" : p.status === "draft" ? "warning" : "neutral"}>
                    {p.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
