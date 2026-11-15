import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/guards";
import { getSubscriptionStatus, severityOf } from "@/lib/queries";
import { db } from "@/lib/db";
import { plans } from "@deepcode/db";
import { and, eq } from "drizzle-orm";
import { Card, Badge, Num, Progress } from "@/components/ui/primitives";
import { CancelButton, PortalButton, ChoosePlanButton } from "@/components/billing-client";
import { formatPrice } from "@/lib/money";
import { env } from "@/lib/env";

/** Billing page (docs/plan/03 §5.1): plan, renewal, change plan, cancel. */
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string; canceled?: string; error?: string }>;
}) {
  const { locale } = await params;
  const loc = locale === "ar" ? "ar" : "en";
  const sp = await searchParams;
  const user = await requireUser();
  const t = await getTranslations("billing");
  const p = await getTranslations("pricing");
  const status = await getSubscriptionStatus(user.id);

  const publicPlans = await db()
    .db.select()
    .from(plans)
    .where(and(eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder);

  const canceled = status?.status === "canceled";

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
      {env.BILLING_PROVIDER === "upi" ? null : (
        <p role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-[13px] text-fg-muted">
          {t("testModeNotice")}
        </p>
      )}
      {sp.checkout === "success" ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/5 p-3 text-[13px] text-success">
          ✓
        </p>
      ) : null}
      {sp.error ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-[13px] text-danger">
          {t.has(`errors.${sp.error}`) ? t(`errors.${sp.error}`) : t("errors.bad_session")}
        </p>
      ) : null}

      {status ? (
        <Card className="p-6" accent>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="text-fg-subtle text-[13px]">{t("currentPlan")}</p>
              <p className="text-scale-md font-semibold">{status.plan.name[loc]}</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={status.status === "active" ? "success" : status.status === "past_due" ? "danger" : "warning"}>
                  {status.status}
                </Badge>
                {canceled ? <Badge tone="warning">{t("canceledNote")}</Badge> : null}
              </div>
            </div>
            <div className="text-end">
              <p className="text-fg-subtle text-[13px]">{t("renewsOn")}</p>
              <Num>{status.period.expiresAt.slice(0, 10)}</Num>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            <Progress
              value={status.credits.used}
              max={status.credits.limit || 1}
              level={severityOf(status)}
              label={t("creditsThisPeriod")}
            />
            <p className="text-[13px] text-fg-muted">
              <Num>{status.credits.used.toLocaleString("en-US")}</Num> /{" "}
              <Num>{status.credits.limit.toLocaleString("en-US")}</Num> {t("creditsThisPeriod")}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <PortalButton />
            {!canceled ? <CancelButton atPeriodEnd /> : null}
          </div>
        </Card>
      ) : null}

      <section>
        <h2 className="text-scale-md font-semibold mb-4">{t("changePlan")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {publicPlans.map((plan) => (
            <Card key={plan.id} className="p-5 flex flex-col gap-3">
              <p className="font-semibold">{loc === "ar" ? plan.nameAr : plan.nameEn}</p>
              <p className="flex items-baseline gap-1.5">
                <Num className="text-scale-md">{formatPrice(plan.priceCents, plan.currency)}</Num>
                <span className="text-fg-muted text-[13px]">{plan.interval === "year" ? p("perYear") : p("perMonth")}</span>
              </p>
              <p className="text-[13px] text-fg-muted">
                <Num>{plan.creditsPerPeriod.toLocaleString("en-US")}</Num> {p("creditsPerPeriod")}
              </p>
              <div className="mt-auto">
                {status?.plan.id === plan.id ? (
                  <Badge tone="primary">{p("current")}</Badge>
                ) : plan.priceCents > 0 ? (
                  <ChoosePlanButton planId={plan.id} label={p("choose")} />
                ) : (
                  <Badge>{p("recommended")}</Badge>
                )}
              </div>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-fg-subtle">{p("sub")}</p>
      </section>
    </div>
  );
}
