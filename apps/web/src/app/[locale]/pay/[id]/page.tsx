import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { plans } from "@deepcode/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/guards";
import { getUserPayment, upiPayUri } from "@/lib/billing/upi";
import { formatPrice } from "@/lib/money";
import { submitUpiUtrAction } from "@/actions/billing";
import { SubmitButton } from "@/components/ui/client";
import { Card, Num } from "@/components/ui/primitives";
import { LtrIsland } from "@/components/ltr-island";
import { LocaleLink } from "@/components/locale-link";

/**
 * UPI QR payment page (owner decision 2026-11-15): scan → pay → submit UTR →
 * wait for the admin's confirmation. Only the owner of the payment can see it.
 */
export default async function UpiPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  const loc = locale === "ar" ? "ar" : "en";
  const t = await getTranslations("upi");
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const payment = await getUserPayment(db().db, id, user.id);
  if (!payment) notFound();
  const [plan] = await db().db.select().from(plans).where(eq(plans.id, payment.planId));

  const vpa = env.UPI_PAYEE_VPA;
  const uri = vpa
    ? upiPayUri({
        vpa,
        payeeName: env.UPI_PAYEE_NAME,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reference: payment.reference,
      })
    : null;
  const qrSvg = uri
    ? await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: 240 })
    : null;

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-6 px-4 py-10">
      <Card className="p-6">
        <h1 className="text-scale-md font-semibold">{t("title")}</h1>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-fg-subtle">{t("plan")}</dt>
          <dd className="font-medium">{plan ? (loc === "ar" ? plan.nameAr : plan.nameEn) : payment.planId}</dd>
          <dt className="text-fg-subtle">{t("amount")}</dt>
          <dd>
            <Num className="font-semibold">{formatPrice(payment.amountMinor, payment.currency)}</Num>
          </dd>
          <dt className="text-fg-subtle">{t("reference")}</dt>
          <dd>
            <LtrIsland>
              <code className="font-mono">{payment.reference}</code>
            </LtrIsland>
          </dd>
          {vpa ? (
            <>
              <dt className="text-fg-subtle">{t("payee")}</dt>
              <dd>
                <LtrIsland>
                  <span className="font-mono">{vpa}</span>
                </LtrIsland>
              </dd>
            </>
          ) : null}
        </dl>

        {payment.status === "awaiting_payment" ? (
          <>
            {qrSvg && uri ? (
              <div className="mt-6 grid justify-items-center gap-3">
                <div
                  className="rounded-lg bg-white p-3"
                  role="img"
                  aria-label={`UPI QR ${payment.reference}`}
                  // SVG generated server-side from our own payment data.
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <p className="text-center text-[13px] leading-6 text-fg-muted">{t("scan")}</p>
                <a
                  href={uri}
                  className="inline-flex h-9 items-center rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2"
                >
                  {t("openApp")}
                </a>
                <p className="text-[12px] text-fg-subtle">
                  {t("expiresAt")}: <Num>{payment.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC</Num>
                </p>
              </div>
            ) : (
              <p role="alert" className="mt-6 text-[14px] text-danger">
                {t("notConfigured")}
              </p>
            )}

            <form action={submitUpiUtrAction} className="mt-6 grid gap-2">
              <input type="hidden" name="paymentId" value={payment.id} />
              <label htmlFor="utr" className="text-[14px] font-medium">
                {t("utrLabel")}
              </label>
              <input
                id="utr"
                name="utr"
                required
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                maxLength={40}
                pattern="[A-Za-z0-9 \-]{8,40}"
                aria-describedby="utr-hint"
                className="h-10 rounded-sm border border-border bg-surface px-3 font-mono text-[15px]"
              />
              <p id="utr-hint" className="text-[12px] leading-5 text-fg-subtle">
                {t("utrHint")}
              </p>
              {error ? (
                <p role="alert" className="text-[13px] text-danger">
                  {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.not_found")}
                </p>
              ) : null}
              <SubmitButton>{t("submit")}</SubmitButton>
            </form>
          </>
        ) : (
          <div className="mt-6 grid gap-4">
            <p
              role="status"
              className={
                payment.status === "approved"
                  ? "rounded-lg border border-success/40 bg-success/5 p-3 text-[14px] text-success"
                  : payment.status === "submitted"
                    ? "rounded-lg border border-primary/40 bg-primary/5 p-3 text-[14px]"
                    : "rounded-lg border border-danger/40 bg-danger/5 p-3 text-[14px] text-danger"
              }
            >
              {payment.status === "submitted"
                ? t("submitted", { utr: payment.utr ?? "" })
                : payment.status === "approved"
                  ? t("approved")
                  : payment.status === "rejected"
                    ? `${t("rejected")}${payment.rejectReason ? ` — ${payment.rejectReason}` : ""}`
                    : t("expired")}
            </p>
            <LocaleLink
              locale={locale}
              href={payment.status === "approved" ? "/dashboard" : "/dashboard/billing"}
              className="text-[14px] text-primary underline-offset-4 hover:underline"
            >
              {payment.status === "approved" ? t("goDashboard") : t("backToBilling")}
            </LocaleLink>
          </div>
        )}
      </Card>
    </main>
  );
}
