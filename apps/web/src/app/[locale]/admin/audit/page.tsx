import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { auditLogs, users } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";

export default async function AdminAuditPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  await requireAdmin();
  const t = await getTranslations("admin");

  const rows = await db()
    .db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      actorId: auditLogs.actorId,
      actorEmail: users.email,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("audit")}</h1>
      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("when")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("action")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("actor")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("target")}</th>
              <th className="px-4 py-2 text-start font-medium">ip</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Num>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Num>
                </td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px]">{r.action}</LtrIsland>
                </td>
                <td className="px-4 py-2 text-fg-muted">{r.actorEmail ?? "—"}</td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px] text-fg-muted">
                    {r.targetType}:{r.targetId?.slice(0, 8) ?? ""}
                  </LtrIsland>
                </td>
                <td className="px-4 py-2">
                  <Num>{r.ip ?? "—"}</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {rows.length === 0 ? <p className="text-fg-muted text-[14px]">{t("emptyAudit")}</p> : null}
    </div>
  );
}
