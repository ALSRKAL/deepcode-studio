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
      quotaRemainingPct: upstreamPoolKeys.quotaRemainingPct,
      quotaRenewsAt: upstreamPoolKeys.quotaRenewsAt,
      quotaCheckedAt: upstreamPoolKeys.quotaCheckedAt,
    })
    .from(upstreamPoolKeys)
    .orderBy(desc(sql`${upstreamPoolKeys.createdAt}`));

  // Live upstream quota (Synthetic /v2/quotas, polled by the gateway every 15 min).
  const activeWithQuota = keys.filter((k) => k.status === "active" && k.quotaRemainingPct !== null);
  const poolCapacity = activeWithQuota.length
    ? Math.round(activeWithQuota.reduce((sum, k) => sum + (k.quotaRemainingPct ?? 0), 0) / activeWithQuota.length)
    : null;
  const soonest = keys
    .map((k) => k.quotaRenewsAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("pool")}</h1>
      {poolCapacity !== null && poolCapacity < 20 ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-[14px]">
          {t("quotaLowAlert", { pct: poolCapacity })}
        </div>
      ) : null}
      <Card className="p-6 grid gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-medium">{t("quotaPool")}</span>
          <Num className="text-[20px]">{poolCapacity === null ? "—" : `${poolCapacity}%`}</Num>
        </div>
        <div className="h-2 w-full rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={poolCapacity ?? 0} aria-label={t("quotaPool")}>
          <div
            className={`h-2 rounded-full ${poolCapacity !== null && poolCapacity < 20 ? "bg-danger" : "bg-primary"}`}
            style={{ width: `${poolCapacity ?? 0}%` }}
          />
        </div>
        <p className="text-[13px] text-fg-subtle">
          {poolCapacity === null ? t("quotaNone") : soonest ? t("quotaNextRenewal", { date: soonest.toISOString().slice(0, 16).replace("T", " ") }) : null}
        </p>
      </Card>
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
              <th className="px-4 py-2 text-start font-medium">{t("quota")}</th>
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
                <td className="px-4 py-2 min-w-36">
                  {k.quotaRemainingPct !== null ? (
                    <div className="grid gap-1">
                      <Num className={k.quotaRemainingPct < 20 ? "text-danger" : undefined}>{k.quotaRemainingPct}%</Num>
                      <div className="h-1.5 w-28 rounded-full bg-surface-2">
                        <div
                          className={`h-1.5 rounded-full ${k.quotaRemainingPct < 20 ? "bg-danger" : "bg-primary"}`}
                          style={{ width: `${k.quotaRemainingPct}%` }}
                        />
                      </div>
                      {k.quotaRenewsAt ? (
                        <span className="text-[12px] text-fg-subtle" dir="ltr">
                          {t("quotaRenews")} {k.quotaRenewsAt.toISOString().slice(0, 16).replace("T", " ")}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-[12px] text-fg-subtle">{k.quotaCheckedAt ? t("quotaNoSubscription") : "—"}</span>
                  )}
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
