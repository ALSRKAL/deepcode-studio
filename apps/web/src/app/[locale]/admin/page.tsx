import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { subscriptions, upstreamPoolKeys, users, usageLogs } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Num, Badge } from "@/components/ui/primitives";
import { PoolSummary } from "@/components/admin-client";

/** Admin health overview (docs/plan/03 §6.1 summary block, Phase 2b fuller). */
export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  const [userCountRows, subCountRows, poolStatusRows, requests24hRows] = await Promise.all([
    db().db.select({ n: sql<number>`count(*)::int` }).from(users),
    db().db
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(sql`${subscriptions.status} in ('trialing','active','past_due')`),
    db().db
      .select({ status: upstreamPoolKeys.status, n: sql<number>`count(*)::int` })
      .from(upstreamPoolKeys)
      .groupBy(upstreamPoolKeys.status),
    db().db
      .select({ n: sql<number>`count(*)::int` })
      .from(usageLogs)
      .where(sql`${usageLogs.createdAt} > now() - interval '24 hours'`),
  ]);
  const userCount = userCountRows[0]!;
  const subCount = subCountRows[0]!;
  const poolStatuses = poolStatusRows;
  const requests24h = requests24hRows[0]!;

  const healthy = Number(poolStatuses.find((r) => r.status === "active")?.n ?? 0);
  const failed = Number(poolStatuses.find((r) => r.status === "auth_failed")?.n ?? 0);

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("overview")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-fg-subtle text-[13px]">{t("users")}</p>
          <Num className="text-scale-lg">{Number(userCount.n).toLocaleString("en-US")}</Num>
        </Card>
        <Card className="p-5">
          <p className="text-fg-subtle text-[13px]">subscriptions</p>
          <Num className="text-scale-lg">{Number(subCount.n).toLocaleString("en-US")}</Num>
        </Card>
        <Card className="p-5">
          <p className="text-fg-subtle text-[13px]">requests / 24h</p>
          <Num className="text-scale-lg">{Number(requests24h.n).toLocaleString("en-US")}</Num>
        </Card>
        <Card className="p-5">
          <p className="text-fg-subtle text-[13px]">{t("pool")}</p>
          <PoolSummary healthy={healthy} cooling={0} failed={failed} utilization={0} />
        </Card>
      </div>
      <div className="flex gap-2">
        {poolStatuses.map((s) => (
          <Badge key={s.status} tone={s.status === "active" ? "success" : s.status === "auth_failed" ? "danger" : "warning"}>
            {s.status}: <Num>{s.n}</Num>
          </Badge>
        ))}
      </div>
    </div>
  );
}
