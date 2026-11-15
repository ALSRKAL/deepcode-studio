import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guards";
import { listPaymentsForAdmin } from "@/lib/billing/upi";
import { utrSeenInSmmDeposits } from "@/lib/firebaseAdmin";
import { formatPrice } from "@/lib/money";
import { reviewUpiPaymentAction } from "@/actions/admin";
import { Badge, Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { LocaleLink } from "@/components/locale-link";

/** UPI payments (owner decision 2026-11-15): web fallback for the phone app. */
export default async function AdminPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale } = await params;
  const { filter } = await searchParams;
  await requireAdmin();
  const t = await getTranslations("adminPayments");
  const view = filter === "all" ? "all" : "submitted";
  const rows = await listPaymentsForAdmin(db().db, view, 100, utrSeenInSmmDeposits);

  return (
    <div className="grid gap-6">
      <h1 className="text-scale-lg font-semibold">{t("title")}</h1>
      <p className="text-[13px] text-fg-muted">{t("checkFirst")}</p>
      <nav className="flex gap-3 text-[14px]" aria-label={t("title")}>
        <LocaleLink locale={locale} href="/admin/payments" className={view === "submitted" ? "font-semibold" : "text-fg-muted"}>
          {t("pending")}
        </LocaleLink>
        <LocaleLink locale={locale} href="/admin/payments?filter=all" className={view === "all" ? "font-semibold" : "text-fg-muted"}>
          {t("all")}
        </LocaleLink>
      </nav>
      {rows.length === 0 ? (
        <Card className="p-6 text-[14px] text-fg-muted">{t("none")}</Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <Card key={r.id} className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Num className="text-scale-md font-semibold">{formatPrice(r.amountMinor, r.currency)}</Num>
                <Badge tone={r.status === "approved" ? "success" : r.status === "submitted" ? "warning" : r.status === "rejected" ? "danger" : "neutral"}>
                  {r.status}
                </Badge>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-fg-subtle">{t("user")}</dt>
                <dd>
                  <LtrIsland>{r.userEmail}</LtrIsland>
                </dd>
                <dt className="text-fg-subtle">{t("utr")}</dt>
                <dd>
                  <LtrIsland>
                    <code className="font-mono">{r.utr ?? "—"}</code>
                  </LtrIsland>
                </dd>
                <dt className="text-fg-subtle">Ref</dt>
                <dd>
                  <LtrIsland>
                    <code className="font-mono">{r.reference}</code>
                  </LtrIsland>
                </dd>
                <dt className="text-fg-subtle">Plan</dt>
                <dd>{locale === "ar" ? r.planNameAr : r.planNameEn}</dd>
              </dl>
              {r.utrSeenElsewhere ? (
                <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 p-2 text-[13px] text-danger">
                  {t("utrSeenElsewhere")}
                </p>
              ) : null}
              {r.status === "submitted" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <form action={reviewUpiPaymentAction}>
                    <input type="hidden" name="paymentId" value={r.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center rounded-sm bg-primary px-4 text-[14px] font-medium text-primary-fg hover:bg-primary-hover"
                    >
                      {t("approve")}
                    </button>
                  </form>
                  <form action={reviewUpiPaymentAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="paymentId" value={r.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <label className="grid gap-1 text-[12px] text-fg-subtle">
                      {t("reason")}
                      <input name="reason" maxLength={300} className="h-9 rounded-sm border border-border bg-surface px-2 text-[14px]" />
                    </label>
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center rounded-sm border border-danger/40 px-4 text-[14px] text-danger hover:bg-danger/10"
                    >
                      {t("reject")}
                    </button>
                  </form>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
