import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/guards";
import { getDailyUsage, getRecentRequests, countRequests } from "@/lib/queries";
import { Card, Num, Badge } from "@/components/ui/primitives";
import { BarChart, LineChart } from "@/components/charts";
import { LtrIsland } from "@/components/ltr-island";

/** Usage page (docs/plan/03 §5): daily credits by model, tokens in/out, history. */
export default async function UsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string; model?: string; status?: string }>;
}) {
  await params;
  const sp = await searchParams;
  const range = sp.range === "30" ? 30 : sp.range === "90" ? 90 : 7;
  const user = await requireUser();
  const t = await getTranslations("usage");
  const d = await getTranslations("dashboard");
  const daily = await getDailyUsage(user.id, range);
  const recent = await getRecentRequests(user.id, 50);
  const total = await countRequests(user.id);

  // Credits by model across the range (categorical order fixed).
  const byModel = new Map<string, number>();
  const byDay = new Map<string, { inTokens: number; outTokens: number }>();
  for (const row of daily) {
    byModel.set(row.model, (byModel.get(row.model) ?? 0) + row.creditsCharged);
    const day = byDay.get(row.day) ?? { inTokens: 0, outTokens: 0 };
    day.inTokens += row.inputTokens;
    day.outTokens += row.outputTokens;
    byDay.set(row.day, day);
  }
  const modelSeries = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const inSeries = days.map(([label, v]) => ({ label, value: v.inTokens }));
  const outSeries = days.map(([label, v]) => ({ label, value: v.outTokens }));

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
        <nav className="flex gap-1" aria-label="range">
          {["7", "30", "90"].map((r) => (
            <a
              key={r}
              href={`?range=${r}`}
              aria-current={range === Number(r) ? "page" : undefined}
              className={`rounded-sm px-3 h-8 inline-flex items-center text-[13px] border transition-colors duration-200 ease-out ${
                range === Number(r) ? "border-primary text-primary" : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {r === "7" ? t("range7") : r === "30" ? t("range30") : t("range90")}
            </a>
          ))}
        </nav>
      </div>

      <Card className="p-6">
        <p className="text-fg-subtle text-[13px] mb-3">{t("creditsByModel")}</p>
        {modelSeries.length > 0 ? (
          <>
            <BarChart series={modelSeries} />
            {/* Accessible table alternative for every chart (docs/plan/03 §5). */}
            <table className="sr-only">
              <caption>{t("creditsByModel")}</caption>
              <thead>
                <tr>
                  <th scope="col">{d("model")}</th>
                  <th scope="col">{d("credits")}</th>
                </tr>
              </thead>
              <tbody>
                {modelSeries.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td>{s.value.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-fg-muted text-[14px]">{d("emptyRequests")}</p>
        )}
      </Card>

      <Card className="p-6">
        <p className="text-fg-subtle text-[13px] mb-3">{t("tokensInOut")}</p>
        {days.length > 0 ? (
          <>
            <LineChart series={inSeries} secondary={outSeries} />
            <p className="mt-2 flex gap-4 text-[13px] text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-primary" /> {d("creditsUsed")} ({t("in")})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-secondary" /> {t("out")}
              </span>
            </p>
          </>
        ) : (
          <p className="text-fg-muted text-[14px]">{d("emptyRequests")}</p>
        )}
      </Card>

      <Card className="overflow-x-auto" scrollLabel={t("title")}>
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-fg-subtle text-[13px]">
            {t("history")} — <Num>{total.toLocaleString("en-US")}</Num>
          </p>
        </div>
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="mt-2 w-full text-[14px]">
            <thead className="text-fg-subtle text-[13px]">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{d("time")}</th>
                <th className="px-4 py-2 text-start font-medium">{d("model")}</th>
                <th className="px-4 py-2 text-start font-medium">{d("tokens")}</th>
                <th className="px-4 py-2 text-start font-medium">{d("credits")}</th>
                <th className="px-4 py-2 text-start font-medium">{d("status")}</th>
                <th className="px-4 py-2 text-start font-medium">{d("duration")}</th>
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
                  <td className="px-4 py-2">
                    <Num>{r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
