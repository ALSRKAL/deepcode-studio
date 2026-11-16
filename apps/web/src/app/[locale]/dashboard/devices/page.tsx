import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { devices } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { Card, Num, EmptyState } from "@/components/ui/primitives";
import { DeviceRevokeButton } from "@/components/devices-client";
import { LtrIsland } from "@/components/ltr-island";

export default async function DevicesPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  const user = await requireUser();
  const t = await getTranslations("devices");
  const rows = await db().db.select().from(devices).where(eq(devices.userId, user.id)).orderBy(devices.createdAt);

  return (
    <div className="grid grid-cols-1 gap-6">
      <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
      <p className="text-fg-muted text-[14px] max-w-prose">{t("body")}</p>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title={t("title")} body={t("empty")} />
          </div>
        ) : (
          <table className="w-full text-[14px]">
            <thead className="text-fg-subtle text-[13px]">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("name")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("os")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("version")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("lastSeen")}</th>
                <th className="px-4 py-2 text-start font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((dev) => (
                <tr key={dev.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{dev.name}</td>
                  <td className="px-4 py-2">
                    <LtrIsland className="text-[13px] text-fg-muted">{dev.os}</LtrIsland>
                  </td>
                  <td className="px-4 py-2">
                    <Num>{dev.appVersion ?? "—"}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <Num>{dev.lastSeenAt ? dev.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <DeviceRevokeButton deviceId={dev.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
