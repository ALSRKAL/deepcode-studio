import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/guards";
import { Card } from "@/components/ui/primitives";
import { SettingsClient } from "@/components/settings-client";
import { and, eq, isNotNull } from "drizzle-orm";
import { authAccounts } from "@deepcode/db";
import { db } from "@/lib/db";

/** Settings (docs/plan/03 §5): profile, language, password, 2FA, delete account. */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ twofa?: string }>;
}) {
  await params;
  const sp = await searchParams;
  const user = await requireUser();
  const t = await getTranslations("settings");
  const [credential] = await db()
    .db.select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "credential"), isNotNull(authAccounts.password)))
    .limit(1);

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
      {sp.twofa === "required" && user.role === "admin" ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-[13px] text-warning">
          {t("twofaRequiredAdmin")}
        </p>
      ) : null}

      <Card className="p-6">
        <SettingsClient
          initialName={user.name ?? ""}
          locale={user.locale === "ar" ? "ar" : "en"}
          twoFactorEnabled={user.twoFactorEnabled}
          twofaUri={null}
          hasPassword={Boolean(credential)}
        />
      </Card>
    </div>
  );
}
