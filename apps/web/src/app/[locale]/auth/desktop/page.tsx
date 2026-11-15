import { getTranslations } from "next-intl/server";
import { and, eq, sql } from "drizzle-orm";
import { DesktopAuthStartQuerySchema, type DesktopAuthStartQuery } from "@deepcode/shared";
import { devices, plans, subscriptions } from "@deepcode/db";
import { currentUser } from "@/lib/guards";
import { db } from "@/lib/db";
import { approveDesktopAuthAction } from "@/actions/auth";
import { SubmitButton } from "@/components/ui/client";
import { SignInForm } from "@/components/auth-forms";
import { Card } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";

/**
 * /auth/desktop — the consent screen (docs/plan/03 §4.1). Query params are
 * untrusted: zod-validated. Signed-out users sign in inline and return here with
 * the parameters preserved in a validated same-app `returnTo` path.
 */
export default async function DesktopAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("desktop");

  let start: DesktopAuthStartQuery | null = DesktopAuthStartQuerySchema.safeParse({
    state: sp.state,
    code_challenge: sp.code_challenge,
    device_name: sp.device_name,
    os: sp.os,
    app_version: typeof sp.app_version === "string" && sp.app_version.length > 0 ? sp.app_version : undefined,
  }).success
    ? DesktopAuthStartQuerySchema.parse({
        state: sp.state,
        code_challenge: sp.code_challenge,
        device_name: sp.device_name,
        os: sp.os,
        app_version: typeof sp.app_version === "string" && sp.app_version.length > 0 ? sp.app_version : undefined,
      })
    : null;

  // Review L13: this page must not set cookies while rendering (Next 15 rejects
  // it and the whole consent flow 500s). When the user is signed out, the inline
  // sign-in form carries the original parameters through a validated internal
  // `returnTo` path instead, so nothing needs to survive in a cookie.
  if (!start) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md place-content-center gap-4 px-4">
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-[14px] text-danger">
          {t("invalidRequest")}
        </p>
      </main>
    );
  }
  const returnTo = `/${locale}/auth/desktop?${new URLSearchParams({
    state: start.state,
    code_challenge: start.code_challenge,
    device_name: start.device_name,
    os: start.os,
    ...(start.app_version ? { app_version: start.app_version } : {}),
  }).toString()}`;

  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-sm place-content-center gap-6 px-4">
        <h1 className="text-scale-md font-semibold text-center">{t("consentTitle")}</h1>
        <p className="text-fg-muted text-[14px] leading-6">{t("consentBody")}</p>
        <SignInForm returnTo={returnTo} />
      </main>
    );
  }

  // Device limit is surfaced before approval (docs/plan/03 §4.1 step 4).
  const [sub] = await db()
    .db.select({ maxDevices: plans.maxDevices })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.userId, user.id), sql`${subscriptions.status} in ('trialing','active','past_due')`))
    .limit(1);
  const deviceCountRows = await db()
    .db.select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(eq(devices.userId, user.id));
  const limitReached = Number(deviceCountRows[0]!.count) >= (sub?.maxDevices ?? 1);

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md place-content-center gap-6 px-4">
      <Card className="p-6">
        <h1 className="text-scale-md font-semibold">{t("consentTitle")}</h1>
        <p className="mt-2 text-[14px] leading-6 text-fg-muted">{t("consentBody")}</p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-fg-subtle">{t("device")}</dt>
          <dd className="font-medium">{start.device_name}</dd>
          <dt className="text-fg-subtle">{t("os")}</dt>
          <dd>
            <LtrIsland className="text-[13px] text-fg-muted">{start.os}</LtrIsland>
          </dd>
          <dt className="text-fg-subtle">Account</dt>
          <dd>
            <LtrIsland className="text-[13px] text-fg-muted">{user.email}</LtrIsland>
          </dd>
        </dl>
        {limitReached ? (
          <p role="alert" className="mt-6 rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-[13px] text-warning">
            {t("deviceLimit")}
          </p>
        ) : (
          <form action={approveDesktopAuthAction} className="mt-6 flex gap-2">
            <input type="hidden" name="state" value={start.state} />
            <input type="hidden" name="code_challenge" value={start.code_challenge} />
            <input type="hidden" name="device_name" value={start.device_name} />
            <input type="hidden" name="os" value={start.os} />
            {start.app_version ? <input type="hidden" name="app_version" value={start.app_version} /> : null}
            <SubmitButton pendingLabel="…">{t("approve")}</SubmitButton>
            <a
              href="/"
              className="inline-flex h-10 items-center rounded-sm border border-border px-4 text-[14px] text-fg-muted hover:text-fg hover:bg-surface-2"
            >
              {t("cancel")}
            </a>
          </form>
        )}
      </Card>
    </main>
  );
}
