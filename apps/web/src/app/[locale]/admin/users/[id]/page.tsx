import { and, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  creditAdjustments,
  devices,
  plans,
  subscriptions,
  usageLogs,
  users,
  virtualApiKeys,
} from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Num, Badge } from "@/components/ui/primitives";
import { AdjustCreditsForm, AssignPlanForm, RevokeAllKeysButton, DeleteUserForm } from "@/components/admin-client";
import { LtrIsland } from "@/components/ltr-island";

/** User detail (docs/plan/03 §6.2): subscription, credit adjustments, keys, devices. */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [user] = await db().db.select().from(users).where(eq(users.id, id));
  if (!user) notFound();

  const [sub] = await db()
    .db.select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.userId, id), sql`${subscriptions.status} in ('trialing','active','past_due')`))
    .limit(1);
  const keys = await db()
    .db.select({ id: virtualApiKeys.id, keyPrefix: virtualApiKeys.keyPrefix, last4: virtualApiKeys.last4, kind: virtualApiKeys.kind, status: virtualApiKeys.status })
    .from(virtualApiKeys)
    .where(eq(virtualApiKeys.userId, id))
    .orderBy(desc(virtualApiKeys.createdAt))
    .limit(20);
  const deviceRows = await db().db.select().from(devices).where(eq(devices.userId, id));
  const recentUsage = await db()
    .db.select({ model: usageLogs.model, credits: usageLogs.creditsCharged, createdAt: usageLogs.createdAt })
    .from(usageLogs)
    .where(eq(usageLogs.userId, id))
    .orderBy(desc(usageLogs.createdAt))
    .limit(10);
  const adjustments = await db()
    .db.select()
    .from(creditAdjustments)
    .where(eq(creditAdjustments.subscriptionId, sub?.s.id ?? "00000000-0000-0000-0000-000000000000"))
    .orderBy(desc(creditAdjustments.createdAt))
    .limit(10);
  const planIds = (await db().db.select({ id: plans.id }).from(plans)).map((p) => p.id);

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">
        <LtrIsland className="text-scale-md">{user.email}</LtrIsland>
      </h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <p className="text-fg-subtle text-[13px] mb-2">subscription</p>
          {sub ? (
            <div className="grid gap-1 text-[14px]">
              <span>
                <LtrIsland className="text-[13px]">{sub.p.id}</LtrIsland> <Badge tone="success">{sub.s.status}</Badge>
              </span>
              <span className="text-fg-muted">
                <Num>{Number(sub.s.creditsUsed).toLocaleString("en-US")}</Num> /{" "}
                <Num>{Number(sub.s.creditsLimit).toLocaleString("en-US")}</Num> credits
              </span>
              <span className="text-fg-muted text-[13px]">
                expires <Num>{sub.s.expiresAt.toISOString().slice(0, 10)}</Num>
              </span>
            </div>
          ) : (
            <p className="text-fg-muted">—</p>
          )}
          <div className="mt-5 grid gap-4">
            {sub ? <AdjustCreditsForm subscriptionId={sub.s.id} /> : null}
            <AssignPlanForm userId={id} planIds={planIds} />
            <RevokeAllKeysButton userId={id} />
            {user.role !== "admin" ? <DeleteUserForm userId={id} email={user.email} /> : null}
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-6">
            <p className="text-fg-subtle text-[13px] mb-2">
              {t("keys")} ({keys.length})
            </p>
            <ul className="grid gap-1 text-[13px]">
              {keys.map((k) => (
                <li key={k.id}>
                  <LtrIsland className="text-fg-muted">
                    {k.keyPrefix}…{k.last4}
                  </LtrIsland>{" "}
                  <Badge tone={k.status === "active" ? "success" : "neutral"}>{k.kind}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <p className="text-fg-subtle text-[13px] mb-2">
              {t("devices")} ({deviceRows.length})
            </p>
            <ul className="grid gap-1 text-[13px] text-fg-muted">
              {deviceRows.map((dv) => (
                <li key={dv.id}>{dv.name}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <p className="px-4 pt-4 text-fg-subtle text-[13px]">{t("usage")}</p>
        <table className="mt-2 w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("when")}</th>
              <th className="px-4 py-2 text-start font-medium">model</th>
              <th className="px-4 py-2 text-start font-medium">credits</th>
            </tr>
          </thead>
          <tbody>
            {recentUsage.map((u, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-4 py-2">
                  <Num>{u.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Num>
                </td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px]">{u.model}</LtrIsland>
                </td>
                <td className="px-4 py-2">
                  <Num>{Number(u.credits).toLocaleString("en-US")}</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <p className="px-4 pt-4 text-fg-subtle text-[13px]">{t("adjustments")}</p>
        <table className="mt-2 w-full text-[14px]">
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Num>{Number(a.deltaCredits).toLocaleString("en-US")}</Num>
                </td>
                <td className="px-4 py-2 text-fg-muted">{a.reason}</td>
                <td className="px-4 py-2">
                  <Num>{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
