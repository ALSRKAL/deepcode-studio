import { desc, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { upstreamPoolKeys, upstreamProviders } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Num, Badge } from "@/components/ui/primitives";
import { AddPoolKeyForm, PoolKeyStatusButton } from "@/components/admin-client";
import { LtrIsland } from "@/components/ltr-island";

/**
 * Pool manager (docs/plan/03 §6.1, W-08): the add-key form is write-only; the
 * table shows fingerprints, never ciphertext or plaintext.
 */
export default async function AdminPoolPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  const providers = await db().db.select().from(upstreamProviders).orderBy(upstreamProviders.id);
  const keys = await db()
    .db.select({
      id: upstreamPoolKeys.id,
      providerId: upstreamPoolKeys.providerId,
      label: upstreamPoolKeys.label,
      fingerprint: upstreamPoolKeys.keyFingerprint,
      status: upstreamPoolKeys.status,
      weight: upstreamPoolKeys.weight,
      maxConcurrency: upstreamPoolKeys.maxConcurrency,
      totalRequests: upstreamPoolKeys.totalRequests,
      total429: upstreamPoolKeys.total429,
      total5xx: upstreamPoolKeys.total5xx,
      lastErrorAt: upstreamPoolKeys.lastErrorAt,
      lastErrorCode: upstreamPoolKeys.lastErrorCode,
      keyVersion: upstreamPoolKeys.keyVersion,
    })
    .from(upstreamPoolKeys)
    .orderBy(desc(sql`${upstreamPoolKeys.createdAt}`));

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("pool")}</h1>
      <Card className="p-6">
        <AddPoolKeyForm providers={providers.map((p) => ({ id: p.id, displayName: p.displayName }))} />
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">provider</th>
              <th className="px-4 py-2 text-start font-medium">{t("keyLabel")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("fingerprint")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("requests")}</th>
              <th className="px-4 py-2 text-start font-medium">429 / 5xx</th>
              <th className="px-4 py-2 text-start font-medium">{t("lastError")}</th>
              <th className="px-4 py-2 text-start font-medium" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px] text-fg-muted">{k.providerId}</LtrIsland>
                </td>
                <td className="px-4 py-2 font-medium">{k.label}</td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px] text-fg-muted">{k.fingerprint}</LtrIsland>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={k.status === "active" ? "success" : k.status === "auth_failed" ? "danger" : "warning"}>
                    {k.status}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <Num>{Number(k.totalRequests).toLocaleString("en-US")}</Num>
                </td>
                <td className="px-4 py-2">
                  <Num>
                    {Number(k.total429).toLocaleString("en-US")} / {Number(k.total5xx).toLocaleString("en-US")}
                  </Num>
                </td>
                <td className="px-4 py-2">
                  {k.lastErrorCode ? (
                    <span className="text-[13px] text-danger font-mono" dir="ltr">
                      {k.lastErrorCode}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {k.status !== "auth_failed" ? <PoolKeyStatusButton keyId={k.id} status={k.status} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
