import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/guards";
import { bannerOf, getDailyUsage, getRecentRequests, getSubscriptionStatus, severityOf } from "@/lib/queries";
import { Card, Progress, Num, EmptyState, Badge } from "@/components/ui/primitives";
import { LineChart, Sparkline } from "@/components/charts";
import { LtrIsland } from "@/components/ltr-island";
import { ButtonLink } from "@/components/ui/button";

/** Dashboard overview (docs/plan/03 §5): the IDE HUD, large, plus banners. */
export default async function DashboardOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireUser();
  const t = await getTranslations("dashboard");
  const status = await getSubscriptionStatus(user.id);
  const usage7 = await getDailyUsage(user.id, 7);
  const recent = await getRecentRequests(user.id, 5);

  // Daily totals for the sparkline.
  const byDay = new Map<string, number>();
  for (const u of usage7) byDay.set(u.day, (byDay.get(u.day) ?? 0) + u.creditsCharged);
  const spark = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = byDay.get(todayKey) ?? 0;

  const banner = bannerOf(status, locale);
  const bannerKey: Record<string, string> = {
    warn80: "warn80",
    warn95: "warn95",
    expiringSoon: "expiringSoon",
    paymentFailed: "paymentFailed",
    expired: "expired",
    noSubscription: "noSubscription",
  };
  const bannerTones: Record<string, string> = {
    warn80: "border-warning/40 bg-warning/5 text-warning",
    warn95: "border-danger/40 bg-danger/5 text-danger",
    expiringSoon: "border-warning/40 bg-warning/5 text-warning",
    paymentFailed: "border-danger/40 bg-danger/5 text-danger",
    expired: "border-danger/40 bg-danger/5 text-danger",
    noSubscription: "border-border bg-surface text-fg-muted",
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("title")}</h1>

      {banner !== "none" ? (
        <div role="status" className={`rounded-lg border p-4 text-[14px] ${bannerTones[banner]}`}>
          {t(bannerKey[banner]!)}
          {banner === "noSubscription" || banner === "expired" || banner === "paymentFailed" ? (
            <div className="mt-3">
              <ButtonLink href={`/${locale}/dashboard/billing`} size="sm" variant="secondary">
                {t("billing")}
              </ButtonLink>
            </div>
          ) : null}
        </div>
      ) : null}

      {status ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <p className="text-fg-subtle text-[13px]">{t("plan")}</p>
              <p className="text-scale-md font-semibold">{locale === "ar" ? status.plan.name.ar : status.plan.name.en}</p>
            </div>
            <div className="text-end">
              <p className="text-fg-subtle text-[13px]">{t("creditsRemaining")}</p>
              <Num className="text-scale-md text-fg">{status.credits.remaining.toLocaleString("en-US")}</Num>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            <Progress
              value={status.credits.used}
              max={status.credits.limit || 1}
              level={severityOf(status)}
              label={t("creditsUsed")}
            />
            <div className="flex justify-between text-[13px] text-fg-muted">
              <span>
                {t("creditsUsed")}: <Num>{status.credits.used.toLocaleString("en-US")}</Num> /{" "}
                <Num>{status.credits.limit.toLocaleString("en-US")}</Num>
              </span>
              <span>{t("expiresIn", { days: status.period.daysLeft })}</span>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <p className="text-fg-subtle text-[13px]">{t("todayUsage")}</p>
          <Num className="text-scale-lg">{today.toLocaleString("en-US")}</Num>
          <p className="mt-1 text-fg-subtle text-[13px]">{t("last7")}</p>
          <Sparkline values={spark.length > 1 ? spark : [0, 0]} />
        </Card>
        <Card className="p-6">
          <p className="text-fg-subtle text-[13px]">{t("last7")}</p>
          <LineChart series={spark.map((v, i) => ({ label: `d${i}`, value: v }))} />
        </Card>
      </div>

      <Card className="overflow-hidden">
        <p className="px-4 pt-4 text-fg-subtle text-[13px]">{t("lastRequests")}</p>
        {recent.length === 0 ? (
          <div className="p-6">
            <EmptyState title={t("lastRequests")} body={t("emptyRequests")} />
          </div>
        ) : (
          <table className="mt-2 w-full text-[14px]">
            <thead className="text-fg-subtle text-[13px]">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("time")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("model")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("tokens")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("credits")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.requestId} className="border-t border-border">
                  <td className="px-4 py-2 text-fg-muted">
                    <Num>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <LtrIsland className="text-[13px]">{r.model}</LtrIsland>
                  </td>
                  <td className="px-4 py-2">
                    <Num>
                      {r.inputTokens.toLocaleString("en-US")} / {r.outputTokens.toLocaleString("en-US")}
                    </Num>
                  </td>
                  <td className="px-4 py-2">
                    <Num>{r.creditsCharged.toLocaleString("en-US")}</Num>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={r.status === "ok" ? "success" : r.status === "client_abort" ? "warning" : "danger"}>
                      {r.status}
                      {r.estimated ? ` · ${t("estimated")}` : ""}
                    </Badge>
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
