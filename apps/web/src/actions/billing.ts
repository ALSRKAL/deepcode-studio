"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { plans, subscriptions } from "@deepcode/db";
import { db } from "@/lib/db";
import { billingProvider } from "@/lib/billing";
import { requireUser, localized } from "@/lib/guards";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import { submitUtr } from "@/lib/billing/upi";

/** Checkout + cancellation (docs/plan/03 §5.1). Provider-neutral interface. */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const planId = z.string().min(1).max(100).safeParse(formData.get("planId"));
  if (!planId.success) return;
  const user = await requireUser();
  const [plan] = await db().db.select().from(plans).where(and(eq(plans.id, planId.data), eq(plans.isPublic, true)));
  if (!plan || plan.priceCents === 0) {
    redirect(await localized("/dashboard/billing?error=plan_unavailable"));
  }
  const provider = billingProvider();
  const { url } = await provider.createCheckout({
    userId: user.id,
    planId: plan!.id,
    locale: user.locale === "ar" ? "ar" : "en",
    successUrl: `${env.APP_URL}/dashboard/billing?checkout=success`,
    cancelUrl: `${env.APP_URL}/dashboard/billing?checkout=canceled`,
  });
  redirect(url);
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  const atPeriodEnd = formData.get("atPeriodEnd") !== "false";
  const user = await requireUser();
  const [sub] = await db()
    .db.select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, user.id), sql`${subscriptions.status} in ('active','trialing','past_due')`))
    .limit(1);
  if (!sub?.providerSubscriptionId) return;
  const provider = billingProvider();
  await provider.cancel(sub.providerSubscriptionId, { atPeriodEnd });
  revalidatePath("/dashboard/billing");
  redirect(await localized("/dashboard/billing?canceled=1"));
}

/** Mock checkout page: the user pressed "Pay" on the local test-mode page. */
export async function completeMockCheckoutAction(formData: FormData): Promise<void> {
  const sessionId = z.string().uuid().safeParse(formData.get("session"));
  if (!sessionId.success) redirect(await localized("/dashboard/billing?error=bad_session"));
  const user = await requireUser();
  const { MockBillingProvider } = await import("@/lib/billing/mock");
  const mock = new MockBillingProvider({ db: db().db, appUrl: env.APP_URL });
  await mock.completeCheckout(sessionId.data, user.id);
  revalidatePath("/dashboard");
  redirect(await localized("/dashboard/billing?checkout=success"));
}

/** UPI: the user reports the UTR after paying (lib/billing/upi.ts). */
export async function submitUpiUtrAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("paymentId"));
  if (!id.success) redirect(await localized("/dashboard/billing?error=bad_session"));
  const user = await requireUser();
  const limited = await rateLimit(`upi-utr:${user.id}`, 10, 3600);
  if (!limited.allowed) redirect(await localized(`/pay/${id.data}?error=wrong_state`));
  const result = await submitUtr(db().db, { id: id.data, userId: user.id, utr: String(formData.get("utr") ?? "") });
  revalidatePath(`/pay/${id.data}`);
  redirect(await localized(result.ok ? `/pay/${id.data}` : `/pay/${id.data}?error=${result.code}`));
}
