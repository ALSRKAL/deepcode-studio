import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { plans, upstreamProviders } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { listModelsForAdmin } from "@/lib/modelAdmin";
import { addModelsToPlanAction, setModelPlansAction, setModelPriceAction, updateModelAction } from "@/actions/models";
import { Badge, Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";

const input = "h-8 rounded-sm border border-border bg-surface px-2 text-[13px]";
const small = "inline-flex h-8 items-center rounded-sm border border-border px-3 text-[13px] hover:bg-surface-2";

const fmtCtx = (n: number | null) => (n === null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}K`);

/** Models, prices and plan access (owner request 2026-11-15). */
export default async function AdminModelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; provider?: string; free?: string; status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  await requireAdmin();
  const t = await getTranslations("adminModels");
  const status = (["active", "hidden", "retired", "all"] as const).find((s) => s === sp.status) ?? "active";
  const rows = await listModelsForAdmin(db().db, {
    q: sp.q,
    provider: sp.provider || undefined,
    free: sp.free === "1",
    status,
  });
  const planRows = await db().db.select({ id: plans.id, nameEn: plans.nameEn, nameAr: plans.nameAr }).from(plans).orderBy(asc(plans.sortOrder));
  const providers = await db().db.select({ id: upstreamProviders.id, name: upstreamProviders.displayName }).from(upstreamProviders);
  const planName = (p: (typeof planRows)[number]) => (locale === "ar" ? p.nameAr : p.nameEn);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-scale-lg font-semibold">{t("modelsTitle")}</h1>
        <p className="text-[13px] leading-6 text-fg-muted">{t("modelsIntro")}</p>
      </div>

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="grid gap-1 text-[12px]">
            <span className="text-fg-muted">{t("search")}</span>
            <input name="q" defaultValue={sp.q ?? ""} className={input} dir="ltr" />
          </label>
          <label className="grid gap-1 text-[12px]">
            <span className="text-fg-muted">{t("models")}</span>
            <select name="provider" defaultValue={sp.provider ?? ""} className={input}>
              <option value="">{t("allProviders")}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px]">
            <span className="text-fg-muted">{t("status")}</span>
            <select name="status" defaultValue={status} className={input}>
              <option value="active">{t("statusActive")}</option>
              <option value="hidden">{t("statusHidden")}</option>
              <option value="retired">{t("statusRetired")}</option>
              <option value="all">{t("statusAll")}</option>
            </select>
          </label>
          <label className="flex h-8 items-center gap-2 text-[13px]">
            <input type="checkbox" name="free" value="1" defaultChecked={sp.free === "1"} className="size-4" /> {t("freeOnly")}
          </label>
          <button type="submit" className={small}>
            {t("filter")}
          </button>
        </form>
      </Card>

      <Card className="grid gap-2 p-4">
        <h2 className="text-[14px] font-semibold">{t("bulkTitle")}</h2>
        <form action={addModelsToPlanAction} className="flex flex-wrap items-end gap-3">
          <select name="planId" className={input} aria-label={t("colPlans")}>
            {planRows.map((p) => (
              <option key={p.id} value={p.id}>
                {planName(p)}
              </option>
            ))}
          </select>
          <select name="selection" className={input} aria-label={t("bulkTitle")}>
            <option value="free">{t("bulkFree")}</option>
            <option value="provider">{t("bulkProvider")}</option>
          </select>
          <select name="providerId" className={input} aria-label={t("models")}>
            <option value="">—</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className={small}>
            {t("bulkAdd")}
          </button>
        </form>
        <p className="text-[12px] text-fg-subtle">{t("bulkNote")}</p>
      </Card>

      <div className="grid gap-3">
        {rows.map((m) => (
          <Card key={m.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-semibold">{m.displayName}</p>
                {m.isFree ? <Badge tone="success">{t("free")}</Badge> : null}
                {m.status !== "active" ? <Badge tone={m.status === "retired" ? "danger" : "warning"}>{m.status}</Badge> : null}
                {m.trainsOnData ? <Badge tone="danger">{t("trains")}</Badge> : null}
                {m.badge ? <Badge tone="primary">{m.badge}</Badge> : null}
              </div>
              <LtrIsland className="font-mono text-[12px] text-fg-subtle">{m.id}</LtrIsland>
              <p className="text-[12px] text-fg-muted">
                {t("colContext")}: <Num>{fmtCtx(m.contextWindow)}</Num>
                {m.capabilities.reasoning ? ` · ${t("reasoning")}` : ""}
                {m.capabilities.vision ? ` · ${t("vision")}` : ""}
                {m.capabilities.tools ? ` · ${t("tools")}` : ""}
              </p>
              <p className="text-[12px] text-fg-muted">
                <LtrIsland>{m.providers.join(", ") || "—"}</LtrIsland>
              </p>
              {m.note ? <p className="text-[12px] text-warning">{m.note}</p> : null}
              {m.description ? <p className="line-clamp-2 text-[12px] text-fg-subtle">{m.description}</p> : null}
            </div>

            <div className="grid content-start gap-2">
              <p className="text-[12px] text-fg-muted">
                {t("colUpstream")}:{" "}
                <Num>
                  {m.upstreamCostUsd ? `${m.upstreamCostUsd.input} / ${m.upstreamCostUsd.output}` : "—"}
                  {m.upstreamCostUsd?.variable ? ` (${t("variable")})` : ""}
                </Num>
              </p>
              <form action={setModelPriceAction} className="grid gap-1.5">
                <span className="text-[12px] text-fg-muted">{t("colPrice")}</span>
                <input type="hidden" name="id" value={m.id} />
                <div className="flex flex-wrap gap-1.5" dir="ltr">
                  <input name="input" type="number" min={0} defaultValue={m.price?.input ?? ""} required className={`${input} w-24`} aria-label="input" />
                  <input name="output" type="number" min={0} defaultValue={m.price?.output ?? ""} required className={`${input} w-24`} aria-label="output" />
                  <input name="cached" type="number" min={0} defaultValue={m.price?.cached ?? ""} required className={`${input} w-24`} aria-label="cached" />
                  <button type="submit" className={small}>
                    {t("savePrice")}
                  </button>
                </div>
              </form>
              {m.status !== "retired" ? (
                <form action={updateModelAction} className="grid gap-1.5">
                  <span className="text-[12px] text-fg-muted">{t("colSettings")}</span>
                  <input type="hidden" name="id" value={m.id} />
                  <input name="displayName" defaultValue={m.displayName} maxLength={120} className={input} aria-label={t("name")} />
                  <div className="flex flex-wrap gap-1.5">
                    <select name="status" defaultValue={m.status} className={input} aria-label={t("status")}>
                      <option value="active">{t("statusActive")}</option>
                      <option value="hidden">{t("statusHidden")}</option>
                    </select>
                    <select name="badge" defaultValue={m.badge ?? ""} className={input} aria-label={t("badge")}>
                      <option value="">{t("none")}</option>
                      <option value="new">new</option>
                      <option value="recommended">recommended</option>
                      <option value="beta">beta</option>
                    </select>
                    <input name="sortOrder" type="number" min={0} defaultValue={m.sortOrder} className={`${input} w-20`} aria-label={t("order")} />
                    <button type="submit" className={small}>
                      {t("saveDisplay")}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>

            <form action={setModelPlansAction} className="grid content-start gap-1.5">
              <span className="text-[12px] text-fg-muted">{t("colPlans")}</span>
              <input type="hidden" name="id" value={m.id} />
              {planRows.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    name="planIds"
                    value={p.id}
                    defaultChecked={m.planIds.includes(p.id)}
                    disabled={m.status === "retired"}
                    className="size-4"
                  />
                  {planName(p)}
                </label>
              ))}
              {m.status !== "retired" ? (
                <button type="submit" className={`${small} w-fit`}>
                  {t("savePlans")}
                </button>
              ) : null}
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
