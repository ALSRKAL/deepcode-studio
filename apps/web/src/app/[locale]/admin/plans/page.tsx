import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { modelPrices, modelRoutes, plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Num, Badge } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { formatPrice } from "@/lib/money";

/** Plans, models and prices (docs/plan/03 §6.3). Editable plan fields land with
 * Phase 2b actions; this page reads and displays the live tables. */
export default async function AdminPlansPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  const planRows = await db().db.select().from(plans).orderBy(plans.sortOrder);
  const routes = await db()
    .db.select({ model: modelRoutes.model, providerId: modelRoutes.providerId, apiType: modelRoutes.apiType, enabled: modelRoutes.enabled })
    .from(modelRoutes)
    .orderBy(modelRoutes.model);
  const prices = await db()
    .db.select({ model: modelPrices.model, input: modelPrices.inputPerMTok, cached: modelPrices.cachedInputPerMTok, output: modelPrices.outputPerMTok })
    .from(modelPrices)
    .orderBy(sql`${modelPrices.model}`);

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("plans")}</h1>
      <p className="text-[13px] text-warning">{t("placeholderPrices")}</p>

      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">id</th>
              <th className="px-4 py-2 text-start font-medium">price</th>
              <th className="px-4 py-2 text-start font-medium">credits</th>
              <th className="px-4 py-2 text-start font-medium">rpm</th>
              <th className="px-4 py-2 text-start font-medium">devices</th>
              <th className="px-4 py-2 text-start font-medium">models</th>
              <th className="px-4 py-2 text-start font-medium">public</th>
            </tr>
          </thead>
          <tbody>
            {planRows.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px]">{p.id}</LtrIsland>
                </td>
                <td className="px-4 py-2">
                  <Num>{formatPrice(p.priceCents, p.currency)}</Num>
                </td>
                <td className="px-4 py-2">
                  <Num>{Number(p.creditsPerPeriod).toLocaleString("en-US")}</Num>
                </td>
                <td className="px-4 py-2">
                  <Num>{p.rpmLimit}</Num>
                </td>
                <td className="px-4 py-2">
                  <Num>{p.maxDevices}</Num>
                </td>
                <td className="px-4 py-2">
                  <Num>{p.allowedModels.length}</Num>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={p.isPublic ? "success" : "neutral"}>{p.isPublic ? "yes" : "no"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h2 className="text-scale-md font-semibold">{t("models")}</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">model</th>
              <th className="px-4 py-2 text-start font-medium">input / MTok</th>
              <th className="px-4 py-2 text-start font-medium">cached / MTok</th>
              <th className="px-4 py-2 text-start font-medium">output / MTok</th>
              <th className="px-4 py-2 text-start font-medium">api</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((pr) => {
              const route = routes.find((r) => r.model === pr.model);
              return (
                <tr key={pr.model} className="border-t border-border">
                  <td className="px-4 py-2">
                    <LtrIsland className="text-[13px]">{pr.model}</LtrIsland>
                  </td>
                  <td className="px-4 py-2">
                    <Num>{Number(pr.input).toLocaleString("en-US")}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <Num>{Number(pr.cached).toLocaleString("en-US")}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <Num>{Number(pr.output).toLocaleString("en-US")}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{route?.apiType ?? "—"}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
