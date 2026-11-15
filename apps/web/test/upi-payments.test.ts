import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subscriptions, upiPayments } from "@deepcode/db";
import {
  approveUpiPayment,
  createUpiPayment,
  listPaymentsForAdmin,
  normalizeUtr,
  rejectUpiPayment,
  submitUtr,
  upiPayUri,
} from "@/lib/billing/upi";
import { seedWorld } from "./helpers/world.js";

/** UPI QR + manual approval (owner decision 2026-11-15). */
describe("UPI payments", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;
  const utr = () => String(Math.floor(1e11 + Math.random() * 9e11));

  beforeAll(async () => {
    world = await seedWorld({ priceCents: 49_900, currency: "INR" });
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("builds a UPI deep link with fixed amount, currency and reference note", () => {
    const uri = upiPayUri({ vpa: "owner@ybl", payeeName: "DeepCode Studio", amountMinor: 49_900, currency: "INR", reference: "DCABC23456" });
    const url = new URL(uri);
    expect(url.protocol).toBe("upi:");
    expect(url.searchParams.get("pa")).toBe("owner@ybl");
    expect(url.searchParams.get("am")).toBe("499.00");
    expect(url.searchParams.get("cu")).toBe("INR");
    expect(url.searchParams.get("tn")).toBe("DeepCode DCABC23456");
    expect(uri).not.toContain("+");
    expect(normalizeUtr(" 4123-5678 9012 ")).toBe("412356789012");
  });

  it("reuses the open request for the same plan, and caps open requests", async () => {
    const a = await createUpiPayment(world.handle.db, { userId: world.user.id, planId: world.plan.id });
    const b = await createUpiPayment(world.handle.db, { userId: world.user.id, planId: world.plan.id });
    expect(a.ok && b.ok && a.payment.id === b.payment.id).toBe(true);
    if (a.ok) {
      expect(a.payment.amountMinor).toBe(49_900);
      expect(a.payment.currency).toBe("INR");
      expect(a.payment.reference).toMatch(/^DC[2-9A-HJ-NP-Z]{8}$/);
    }
  });

  it("submit → approve activates the plan once; a second approve is refused", async () => {
    const created = await createUpiPayment(world.handle.db, { userId: world.user.id, planId: world.plan.id });
    if (!created.ok) throw new Error(created.code);
    const id = created.payment.id;

    expect(await submitUtr(world.handle.db, { id, userId: world.user.id, utr: "abc" })).toEqual({ ok: false, code: "bad_utr" });
    const code = utr();
    const submitted = await submitUtr(world.handle.db, { id, userId: world.user.id, utr: code });
    expect(submitted.ok).toBe(true);
    expect(await submitUtr(world.handle.db, { id, userId: world.user.id, utr: code })).toEqual({ ok: false, code: "wrong_state" });

    const pending = await listPaymentsForAdmin(world.handle.db, "submitted");
    expect(pending.find((p) => p.id === id)).toMatchObject({ utr: code, userEmail: world.user.email, amountMinor: 49_900 });

    expect(await approveUpiPayment(world.handle.db, { id, reviewer: "firebase:test" })).toEqual({ ok: true });
    expect(await approveUpiPayment(world.handle.db, { id, reviewer: "firebase:test" })).toEqual({ ok: false, code: "wrong_state" });

    const live = await world.handle.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, world.user.id), inArray(subscriptions.status, ["active"])));
    expect(live).toHaveLength(1);
    expect(live[0]!).toMatchObject({ billingProvider: "upi", providerSubscriptionId: `upi-${id}`, creditsUsed: 0 });
    // The seeded subscription to the same plan had ~30 days left: they carry over.
    const days = (live[0]!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(58);
    expect(days).toBeLessThan(61);
  });

  it("a UTR can be used once; rejecting frees it for a corrected request", async () => {
    const other = await seedWorld({ priceCents: 19_900, currency: "INR" });
    try {
      const first = await createUpiPayment(other.handle.db, { userId: other.user.id, planId: other.plan.id });
      if (!first.ok) throw new Error(first.code);
      const code = utr();
      expect((await submitUtr(other.handle.db, { id: first.payment.id, userId: other.user.id, utr: code })).ok).toBe(true);

      // Another user cannot reuse the same UTR.
      const thief = await createUpiPayment(world.handle.db, { userId: world.user.id, planId: world.plan.id });
      if (!thief.ok) throw new Error(thief.code);
      expect(await submitUtr(world.handle.db, { id: thief.payment.id, userId: world.user.id, utr: code })).toEqual({
        ok: false,
        code: "utr_used",
      });
      // Nor can anyone act on someone else's payment.
      expect(await submitUtr(world.handle.db, { id: first.payment.id, userId: world.user.id, utr: utr() })).toEqual({
        ok: false,
        code: "not_found",
      });

      expect(await rejectUpiPayment(other.handle.db, { id: first.payment.id, reviewer: "web:x", reason: "no money" })).toEqual({ ok: true });
      const [row] = await other.handle.db.select().from(upiPayments).where(eq(upiPayments.id, first.payment.id));
      expect(row!.status).toBe("rejected");
      const listed = (await listPaymentsForAdmin(other.handle.db, "all")).find((p) => p.id === first.payment.id);
      expect(listed?.utr).toBe(code);

      const retry = await createUpiPayment(other.handle.db, { userId: other.user.id, planId: other.plan.id });
      if (!retry.ok) throw new Error(retry.code);
      expect((await submitUtr(other.handle.db, { id: retry.payment.id, userId: other.user.id, utr: code })).ok).toBe(true);
    } finally {
      await other.handle.close();
    }
  });

  it("a UTR already claimed as an smm deposit cannot be approved and is flagged for the admin", async () => {
    const other = await seedWorld({ priceCents: 29_900, currency: "INR" });
    try {
      const created = await createUpiPayment(other.handle.db, { userId: other.user.id, planId: other.plan.id });
      if (!created.ok) throw new Error(created.code);
      const code = utr();
      expect((await submitUtr(other.handle.db, { id: created.payment.id, userId: other.user.id, utr: code })).ok).toBe(true);
      const seenInSmm = async (u: string) => u === code;

      const listed = (await listPaymentsForAdmin(other.handle.db, "submitted", 200, seenInSmm)).find(
        (p) => p.id === created.payment.id,
      );
      expect(listed?.utrSeenElsewhere).toBe(true);
      expect(
        await approveUpiPayment(other.handle.db, { id: created.payment.id, reviewer: "x", isUtrUsedElsewhere: seenInSmm }),
      ).toEqual({ ok: false, code: "utr_used_elsewhere" });
      const [row] = await other.handle.db.select().from(upiPayments).where(eq(upiPayments.id, created.payment.id));
      expect(row!.status).toBe("submitted");
      // An unknown answer (Firebase unreachable) does not block the owner's decision.
      expect(
        await approveUpiPayment(other.handle.db, { id: created.payment.id, reviewer: "x", isUtrUsedElsewhere: async () => null }),
      ).toEqual({ ok: true });
    } finally {
      await other.handle.close();
    }
  });

  it("an unpaid request expires and can no longer be submitted", async () => {
    const other = await seedWorld({ priceCents: 9_900, currency: "INR" });
    try {
      const old = new Date(Date.now() - 72 * 3_600_000);
      const created = await createUpiPayment(other.handle.db, { userId: other.user.id, planId: other.plan.id, now: old });
      if (!created.ok) throw new Error(created.code);
      expect(await submitUtr(other.handle.db, { id: created.payment.id, userId: other.user.id, utr: utr() })).toEqual({
        ok: false,
        code: "expired",
      });
    } finally {
      await other.handle.close();
    }
  });

  it("free plans cannot be bought", async () => {
    const free = await seedWorld({ priceCents: 0 });
    try {
      expect(await createUpiPayment(free.handle.db, { userId: free.user.id, planId: free.plan.id })).toEqual({
        ok: false,
        code: "plan_unavailable",
      });
    } finally {
      await free.handle.close();
    }
  });

  it("the phone API answers 503 when Firebase is not configured, never 200", async () => {
    const { GET } = await import("@/app/api/admin/upi-payments/route.js");
    const res = await GET(new Request("http://localhost:3210/api/admin/upi-payments", { headers: { authorization: "Bearer x" } }));
    expect(res.status).toBe(503);
    const { POST } = await import("@/app/api/admin/upi-payments/[id]/route.js");
    const res2 = await POST(
      new Request("http://localhost:3210/api/admin/upi-payments/00000000-0000-0000-0000-000000000000", {
        method: "POST",
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res2.status).toBe(503);
  });
});
