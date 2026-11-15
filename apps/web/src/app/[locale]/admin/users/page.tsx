import { desc, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { users, subscriptions } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { Card, Num, Badge } from "@/components/ui/primitives";
import { UserStatusButton } from "@/components/admin-client";
import { LtrIsland } from "@/components/ltr-island";

/** Admin users list (docs/plan/03 §6.2): search by email or id, status, detail. */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await params;
  const sp = await searchParams;
  await requireAdmin();
  const t = await getTranslations("admin");

  const q = (sp.q ?? "").trim();
  const rows = await db()
    .db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(q ? sql`lower(${users.email}) like ${`%${q.toLowerCase()}%`} or ${users.id}::text = ${q}` : sql`true`)
    .orderBy(desc(sql`${users.createdAt}`))
    .limit(100);

  const liveSubs = await db()
    .db.select({ userId: subscriptions.userId, planId: subscriptions.planId, status: subscriptions.status, creditsLimit: subscriptions.creditsLimit, creditsUsed: subscriptions.creditsUsed, expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(sql`${subscriptions.status} in ('trialing','active','past_due','canceled')`);
  const liveByUser = new Map(liveSubs.map((s) => [s.userId, s]));

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("users")}</h1>
      <form className="flex gap-2" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("userSearch")}
          className="h-10 grow rounded-sm border border-border bg-surface px-3 text-[14px] max-w-md"
        />
        <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
          →
        </button>
      </form>

      <Card className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">email</th>
              <th className="px-4 py-2 text-start font-medium">plan</th>
              <th className="px-4 py-2 text-start font-medium">credits</th>
              <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
              <th className="px-4 py-2 text-start font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const sub = liveByUser.get(u.id);
              return (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <a href={`/ar/admin/users/${u.id}`} className="hover:text-primary">
                      <LtrIsland className="text-[13px]">{u.email}</LtrIsland>
                    </a>
                    {u.role === "admin" ? <Badge tone="primary">admin</Badge> : null}
                  </td>
                  <td className="px-4 py-2">
                    <LtrIsland className="text-[13px] text-fg-muted">{sub?.planId ?? "—"}</LtrIsland>
                  </td>
                  <td className="px-4 py-2">
                    <Num>
                      {sub ? `${Number(sub.creditsUsed).toLocaleString("en-US")} / ${Number(sub.creditsLimit).toLocaleString("en-US")}` : "—"}
                    </Num>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={u.status === "active" ? "success" : "danger"}>{u.status}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <UserStatusButton userId={u.id} status={u.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {rows.length === 0 ? <p className="text-fg-muted text-[14px]">{t("emptyUsers")}</p> : null}
    </div>
  );
}
