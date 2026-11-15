import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { plans, subscriptions, upiPayments, users, type Database } from "@deepcode/db";
import { env } from "../env";
import { markUtrClaimed, pushToAdmins, releaseUtrClaim } from "../firebaseAdmin";
import { handleBillingEvent } from "./apply";
import type { BillingEvent, BillingProvider, CreateCheckoutInput } from "./types";

/**
 * UPI QR payments with manual approval (owner decision 2026-11-15).
 *
 * 1. The user picks a plan → a payment row with a fixed amount and a short
 *    reference is created, and the page shows a UPI QR (`upi://pay?…`) that any
 *    UPI app (PhonePe, GPay, Paytm, BHIM) can scan.
 * 2. After paying, the user submits the bank UTR → status `submitted`, and the
 *    admin phone app receives a push notification.
 * 3. The admin checks the money arrived in their own UPI/bank app, then approves
 *    (or rejects) from the phone app or the web admin panel. Approval activates
 *    the plan through the same idempotent billing-event path as other providers.
 *
 * There is no automatic verification: the admin's confirmation IS the check.
 */

const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
const MAX_OPEN_PER_USER = 3;
export const UTR_PATTERN = /^[A-Z0-9]{8,30}$/;

export type UpiPayment = typeof upiPayments.$inferSelect;
export type UpiError =
  | "not_found"
  | "plan_unavailable"
  | "too_many_open"
  | "not_configured"
  | "bad_utr"
  | "utr_used"
  | "wrong_state"
  | "expired"
  | "utr_used_elsewhere";

export function newReference(): string {
  const bytes = randomBytes(8);
  let out = "DC";
  for (const b of bytes) out += REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length];
  return out;
}

/** Normalises what users paste: spaces/dashes removed, upper-cased. */
export function normalizeUtr(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function formatMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/** UPI deep link per the NPCI URL spec; also the QR payload. */
export function upiPayUri(input: {
  vpa: string;
  payeeName: string;
  amountMinor: number;
  currency: string;
  reference: string;
}): string {
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.payeeName,
    am: formatMinor(input.amountMinor),
    cu: input.currency,
    tn: `DeepCode ${input.reference}`,
  });
  // URLSearchParams encodes spaces as "+", which some UPI apps show literally.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

function isExpired(p: Pick<UpiPayment, "status" | "expiresAt">, now = new Date()): boolean {
  return p.status === "awaiting_payment" && p.expiresAt.getTime() <= now.getTime();
}

/** Marks stale unpaid requests expired (lazy; called on reads). */
export async function expireStale(handle: Database, now = new Date()): Promise<void> {
  await handle
    .update(upiPayments)
    .set({ status: "expired" })
    .where(and(eq(upiPayments.status, "awaiting_payment"), lt(upiPayments.expiresAt, now)));
}

export async function createUpiPayment(
  handle: Database,
  input: { userId: string; planId: string; now?: Date },
): Promise<{ ok: true; payment: UpiPayment } | { ok: false; code: UpiError }> {
  const now = input.now ?? new Date();
  await expireStale(handle, now);
  const [plan] = await handle
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.isPublic, true)));
  if (!plan || plan.priceCents <= 0) return { ok: false, code: "plan_unavailable" };

  const open = await handle
    .select()
    .from(upiPayments)
    .where(and(eq(upiPayments.userId, input.userId), eq(upiPayments.status, "awaiting_payment")))
    .orderBy(desc(upiPayments.createdAt));
  // Re-opening the same plan shows the same QR/reference instead of a new one.
  const same = open.find((p) => p.planId === plan.id && p.amountMinor === plan.priceCents);
  if (same) return { ok: true, payment: same };
  if (open.length >= MAX_OPEN_PER_USER) return { ok: false, code: "too_many_open" };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [payment] = await handle
        .insert(upiPayments)
        .values({
          userId: input.userId,
          planId: plan.id,
          reference: newReference(),
          amountMinor: plan.priceCents,
          currency: plan.currency,
          expiresAt: new Date(now.getTime() + env.UPI_PAYMENT_TTL_HOURS * 3_600_000),
        })
        .returning();
      return { ok: true, payment: payment! };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("could not allocate a unique payment reference");
}

export async function getUserPayment(handle: Database, id: string, userId: string): Promise<UpiPayment | null> {
  await expireStale(handle);
  const [payment] = await handle
    .select()
    .from(upiPayments)
    .where(and(eq(upiPayments.id, id), eq(upiPayments.userId, userId)));
  return payment ?? null;
}

export async function submitUtr(
  handle: Database,
  input: { id: string; userId: string; utr: string; now?: Date },
): Promise<{ ok: true; payment: UpiPayment } | { ok: false; code: UpiError }> {
  const utr = normalizeUtr(input.utr);
  if (!UTR_PATTERN.test(utr)) return { ok: false, code: "bad_utr" };
  const now = input.now ?? new Date();
  const payment = await getUserPayment(handle, input.id, input.userId);
  if (!payment) return { ok: false, code: "not_found" };
  if (isExpired(payment, now) || payment.status === "expired") return { ok: false, code: "expired" };
  if (payment.status !== "awaiting_payment") return { ok: false, code: "wrong_state" };

  let updated: UpiPayment | undefined;
  try {
    [updated] = await handle
      .update(upiPayments)
      .set({ status: "submitted", utr, submittedAt: now })
      .where(and(eq(upiPayments.id, payment.id), eq(upiPayments.status, "awaiting_payment")))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "utr_used" };
    throw error;
  }
  if (!updated) return { ok: false, code: "wrong_state" };

  await markUtrClaimed(utr, updated.id);
  const [owner] = await handle.select({ email: users.email }).from(users).where(eq(users.id, input.userId));
  await pushToAdmins({
    title: "DeepCode: new UPI payment",
    body: `₹${formatMinor(updated.amountMinor)} · ${updated.reference} · UTR ${utr} · ${owner?.email ?? ""}`.trim(),
    data: { type: "deepcode_payment", project: "deepcode", paymentId: updated.id },
  });
  return { ok: true, payment: updated };
}

export interface AdminPaymentRow {
  id: string;
  reference: string;
  status: UpiPayment["status"];
  amountMinor: number;
  currency: string;
  utr: string | null;
  userEmail: string;
  planId: string;
  planNameEn: string;
  planNameAr: string;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectReason: string | null;
  /** true when the same UTR exists in the owner's smm deposits; null = not checked. */
  utrSeenElsewhere: boolean | null;
}

export async function listPaymentsForAdmin(
  handle: Database,
  filter: "submitted" | "all",
  limit = 100,
  isUtrUsedElsewhere?: (utr: string) => Promise<boolean | null>,
): Promise<AdminPaymentRow[]> {
  await expireStale(handle);
  const rows = await handle
    .select({ p: upiPayments, email: users.email, nameEn: plans.nameEn, nameAr: plans.nameAr })
    .from(upiPayments)
    .innerJoin(users, eq(users.id, upiPayments.userId))
    .innerJoin(plans, eq(plans.id, upiPayments.planId))
    .where(filter === "submitted" ? eq(upiPayments.status, "submitted") : undefined)
    .orderBy(desc(upiPayments.submittedAt), desc(upiPayments.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  const mapped = rows.map(({ p, email, nameEn, nameAr }) => ({
    id: p.id,
    reference: p.reference,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    utr: p.utr?.split("-rejected-")[0] ?? null,
    userEmail: email,
    planId: p.planId,
    planNameEn: nameEn,
    planNameAr: nameAr,
    createdAt: p.createdAt.toISOString(),
    submittedAt: p.submittedAt?.toISOString() ?? null,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    reviewedBy: p.reviewedBy,
    rejectReason: p.rejectReason,
    utrSeenElsewhere: null as boolean | null,
  }));
  if (isUtrUsedElsewhere) {
    await Promise.all(
      mapped
        .filter((r) => r.status === "submitted" && r.utr)
        .map(async (r) => {
          r.utrSeenElsewhere = await isUtrUsedElsewhere(r.utr!);
        }),
    );
  }
  return mapped;
}

/**
 * Approve: claim the row atomically (submitted → approved), then activate the
 * plan. A new period starts now; unused days of a live subscription to the SAME
 * plan carry over, so paying early never loses time.
 */
export async function approveUpiPayment(
  handle: Database,
  input: {
    id: string;
    reviewer: string;
    now?: Date;
    /** Owner's other payment records (smm deposits): true blocks the approval. */
    isUtrUsedElsewhere?: (utr: string) => Promise<boolean | null>;
  },
): Promise<{ ok: true } | { ok: false; code: UpiError }> {
  const now = input.now ?? new Date();
  if (input.isUtrUsedElsewhere) {
    const [pending] = await handle.select().from(upiPayments).where(eq(upiPayments.id, input.id));
    if (pending?.utr && (await input.isUtrUsedElsewhere(pending.utr)) === true) {
      return { ok: false, code: "utr_used_elsewhere" };
    }
  }
  const [claimed] = await handle
    .update(upiPayments)
    .set({ status: "approved", reviewedAt: now, reviewedBy: input.reviewer.slice(0, 200) })
    .where(and(eq(upiPayments.id, input.id), eq(upiPayments.status, "submitted")))
    .returning();
  if (!claimed) {
    const [existing] = await handle.select().from(upiPayments).where(eq(upiPayments.id, input.id));
    return { ok: false, code: existing ? "wrong_state" : "not_found" };
  }

  try {
    const [plan] = await handle.select().from(plans).where(eq(plans.id, claimed.planId));
    if (!plan) throw new Error("plan missing");
    const [live] = await handle
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, claimed.userId),
          eq(subscriptions.planId, claimed.planId),
          inArray(subscriptions.status, ["trialing", "active", "past_due"]),
        ),
      )
      .orderBy(desc(subscriptions.expiresAt))
      .limit(1);
    const carryMs = live ? Math.max(0, live.expiresAt.getTime() - now.getTime()) : 0;
    const periodDays = plan.interval === "year" ? 365 : 30;
    const event: BillingEvent = {
      type: "subscription.activated",
      userId: claimed.userId,
      planId: claimed.planId,
      providerSubscriptionId: `upi-${claimed.id}`,
      periodStart: now.toISOString(),
      periodEnd: new Date(now.getTime() + periodDays * 86_400_000 + carryMs).toISOString(),
      providerEventId: `upi-${claimed.id}`,
    };
    await handleBillingEvent(handle, event);
    return { ok: true };
  } catch (error) {
    // Put the claim back so the admin can retry; nothing was activated.
    await handle
      .update(upiPayments)
      .set({ status: "submitted", reviewedAt: null, reviewedBy: null })
      .where(and(eq(upiPayments.id, claimed.id), eq(upiPayments.status, "approved")));
    throw error;
  }
}

export async function rejectUpiPayment(
  handle: Database,
  input: { id: string; reviewer: string; reason?: string; now?: Date },
): Promise<{ ok: true } | { ok: false; code: UpiError }> {
  const [rejected] = await handle
    .update(upiPayments)
    .set({
      status: "rejected",
      reviewedAt: input.now ?? new Date(),
      reviewedBy: input.reviewer.slice(0, 200),
      rejectReason: input.reason?.trim().slice(0, 300) || null,
      // Free the UTR so a mistyped number can be corrected on a new request.
      utr: sql`case when ${upiPayments.utr} is null then null else ${upiPayments.utr} || '-rejected-' || ${upiPayments.id} end`,
    })
    .where(and(eq(upiPayments.id, input.id), inArray(upiPayments.status, ["submitted", "awaiting_payment"])))
    .returning();
  if (!rejected) {
    const [existing] = await handle.select().from(upiPayments).where(eq(upiPayments.id, input.id));
    return { ok: false, code: existing ? "wrong_state" : "not_found" };
  }
  const originalUtr = rejected.utr?.split("-rejected-")[0];
  if (originalUtr) await releaseUtrClaim(originalUtr);
  return { ok: true };
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** BillingProvider adapter: checkout = create the payment and open the QR page. */
export class UpiBillingProvider implements BillingProvider {
  readonly id = "upi" as const;

  constructor(private readonly deps: { db: Database; appUrl: string }) {}

  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string }> {
    if (!env.UPI_PAYEE_VPA) throw new Error("UPI_PAYEE_VPA is not configured");
    const result = await createUpiPayment(this.deps.db, { userId: input.userId, planId: input.planId });
    if (!result.ok) {
      return { url: new URL(`/${input.locale}/dashboard/billing?error=${result.code}`, this.deps.appUrl).toString() };
    }
    return { url: new URL(`/${input.locale}/pay/${result.payment.id}`, this.deps.appUrl).toString() };
  }

  async verifyAndParseWebhook(): Promise<never> {
    // UPI has no provider webhooks here: approval is manual.
    throw new Error("bad_signature");
  }

  async cancel(subscriptionId: string, opts: { atPeriodEnd: boolean }): Promise<void> {
    const [sub] = await this.deps.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.providerSubscriptionId, subscriptionId));
    if (!sub) return;
    await handleBillingEvent(this.deps.db, {
      type: "subscription.canceled",
      providerSubscriptionId: subscriptionId,
      endsAt: (opts.atPeriodEnd ? sub.expiresAt : new Date()).toISOString(),
      providerEventId: `upi-cancel-${randomUUID()}`,
    });
  }
}
