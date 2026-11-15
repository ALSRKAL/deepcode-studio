import { and, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { virtualApiKeys } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { Card, Badge, Num } from "@/components/ui/primitives";
import { CreateKeyForm, RotateKeyButton, RevokeKeyButton } from "@/components/keys-client";
import { LtrIsland } from "@/components/ltr-island";
import { liveSubscription } from "@/lib/apiKeys";

/** API keys page (docs/plan/03 §5): create, shown-once, rotate, revoke. */
export default async function KeysPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  const user = await requireUser();
  const t = await getTranslations("keys");

  const keys = await db()
    .db.select()
    .from(virtualApiKeys)
    .where(and(eq(virtualApiKeys.userId, user.id)))
    .orderBy(sql`${virtualApiKeys.createdAt} desc`);
  const active = keys.filter((k) => k.status === "active");
  const live = await liveSubscription(db().db, user.id);
  const maxKeys = live?.plan.maxKeys ?? 3;

  const gatewayUrl = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");
  const snippet = `curl ${gatewayUrl}/v1/chat/completions \\\n  -H "Authorization: Bearer sk-dc-…" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"hello"}]}'`;

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
      <Card className="p-6">
        <p className="mb-3 text-fg-subtle text-[13px]">
          {active.length} / {maxKeys}
        </p>
        <CreateKeyForm disabled={active.length >= maxKeys} />
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="text-fg-subtle text-[13px]">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("name")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("prefix")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("kind")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("created")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("lastUsed")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-fg-muted">
                  {t("empty")}
                </td>
              </tr>
            ) : null}
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2">
                  <LtrIsland className="text-[13px] text-fg-muted">
                    {k.keyPrefix}…{k.last4}
                  </LtrIsland>
                </td>
                <td className="px-4 py-2 text-fg-muted">{k.kind}</td>
                <td className="px-4 py-2">
                  <Num>{k.createdAt.toISOString().slice(0, 10)}</Num>
                </td>
                <td className="px-4 py-2">
                  <Num>{k.lastUsedAt ? k.lastUsedAt.toISOString().slice(0, 10) : t("never")}</Num>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={k.status === "active" ? "success" : "neutral"}>{k.status}</Badge>
                </td>
                <td className="px-4 py-2">
                  {k.status === "active" ? (
                    <div className="flex gap-1.5">
                      <RotateKeyButton keyId={k.id} />
                      <RevokeKeyButton keyId={k.id} />
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-6">
        <p className="text-fg-subtle text-[13px] mb-2">{t("quickstart")}</p>
        <LtrIsland className="block overflow-x-auto rounded-sm border border-border bg-bg px-3 py-2 text-[12.5px] leading-6 text-fg-muted" as="pre" tabIndex={0}>
          {snippet}
        </LtrIsland>
      </Card>
    </div>
  );
}
