import { and, eq, inArray, sql } from "drizzle-orm";
import { billingEvents, plans, subscriptions, type Database } from "@deepcode/db";
import { invalidateGateway } from "../gateway";
import type { BillingEvent } from "./types";

/**
 * Webhook application (docs/plan/03 §5.1): the signature is verified by the
 * adapter on the raw body before this runs.
 *
 * Review M3: the idempotency row and the state change share ONE transaction. A
 * transient failure rolls the event row back too, so the provider's retry is
 * genuinely reprocessed instead of being swallowed by the unique index. A
 * duplicate delivery (event row already committed) is acknowledged and skipped.
 * The gateway cache invalidation runs after commit.
 */
export async function handleBillingEvent(db: Database, event: BillingEvent): Promise<{ applied: boolean }> {
  const provider = event.providerEventId.startsWith("stripe-")
    ? "stripe"
    : event.providerEventId.startsWith("upi-")
      ? "upi"
      : "mock";

  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(billingEvents)
      .values({
        provider,
        providerEventId: event.providerEventId,
        type: event.type,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });
    if (inserted.length === 0) return { applied: false, userId: null as string | null };

    switch (event.type) {
      case "subscription.activated": {
        const [plan] = await tx.select().from(plans).where(eq(plans.id, event.planId));
        // Throwing rolls everything back, including the event row: an unknown plan
        // is a configuration bug, and the provider retry must be able to succeed
        // after it is fixed.
        if (!plan) throw new Error(`unknown plan ${event.planId}`);
        await tx
          .update(subscriptions)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(
            and(
              eq(subscriptions.userId, event.userId),
              inArray(subscriptions.status, ["trialing", "active", "past_due"]),
            ),
          );
        await tx.insert(subscriptions).values({
          userId: event.userId,
          planId: event.planId,
          status: "active",
          currentPeriodStart: new Date(event.periodStart),
          expiresAt: new Date(event.periodEnd),
          creditsLimit: plan.creditsPerPeriod,
          creditsUsed: 0,
          billingProvider: provider,
          providerSubscriptionId: event.providerSubscriptionId,
        });
        return { applied: true, userId: event.userId as string | null };
      }
      case "subscription.renewed": {
        const [sub] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId))
          .limit(1);
        if (!sub) throw new Error(`unknown subscription ${event.providerSubscriptionId}`);
        const [plan] = await tx.select().from(plans).where(eq(plans.id, event.planId || sub.planId));
        await tx
          .update(subscriptions)
          .set({
            status: "active",
            currentPeriodStart: new Date(event.periodStart),
            expiresAt: new Date(event.periodEnd),
            creditsUsed: 0,
            creditsLimit: plan?.creditsPerPeriod ?? sub.creditsLimit,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));
        return { applied: true, userId: sub.userId };
      }
      case "subscription.past_due": {
        const [sub] = await tx
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId))
          .returning({ userId: subscriptions.userId });
        if (!sub) throw new Error(`unknown subscription ${event.providerSubscriptionId}`);
        return { applied: true, userId: sub.userId };
      }
      case "subscription.canceled": {
        // Access continues until endsAt (docs/plan/02 §10); after that the status
        // rules in the gateway treat it as expired.
        const [sub] = await tx
          .update(subscriptions)
          .set({
            status: "canceled",
            expiresAt: sql`least(${subscriptions.expiresAt}, ${new Date(event.endsAt).toISOString()}::timestamptz)`,
            cancelAtPeriodEnd: true,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId))
          .returning({ userId: subscriptions.userId });
        if (!sub) throw new Error(`unknown subscription ${event.providerSubscriptionId}`);
        return { applied: true, userId: sub.userId };
      }
      case "payment.refunded": {
        // v1: recorded for the admin panel; no automated access change.
        return { applied: true, userId: null as string | null };
      }
    }
  });

  if (outcome.userId) await invalidateGateway({ userIds: [outcome.userId] });
  return { applied: outcome.applied };
}
