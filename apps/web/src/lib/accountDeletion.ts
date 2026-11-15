import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  devices,
  subscriptions,
  usageDaily,
  usageLogs,
  users,
  virtualApiKeys,
  type Database,
} from "@deepcode/db";

/**
 * Account deletion (docs/plan/03 §7, review 2026-11-15).
 *
 * A paid subscription lives at the billing provider, not only in our database.
 * Deleting the user row cascades the subscription row away, so the provider must
 * be told first: otherwise the customer keeps being charged and every renewal
 * webhook afterwards points at a subscription we no longer have. If any provider
 * cancellation fails, nothing is deleted and the caller gets an error to show.
 */
export type LiveProviderSubscription = {
  id: string;
  billingProvider: string;
  providerSubscriptionId: string;
};

export type DeleteAccountResult = { ok: true } | { ok: false; code: "billing_cancel_failed" };

const LIVE_STATUSES = ["trialing", "active", "past_due"] as const;
/** Providers that never charge money, so there is nothing to cancel remotely. */
const LOCAL_PROVIDERS = ["manual", "mock", "upi"] as const;
// UPI payments are one-off transfers: nothing recurs at a provider, so nothing to cancel.

export async function liveProviderSubscriptions(
  handle: Database,
  userId: string,
): Promise<LiveProviderSubscription[]> {
  const rows = await handle
    .select({
      id: subscriptions.id,
      billingProvider: subscriptions.billingProvider,
      providerSubscriptionId: subscriptions.providerSubscriptionId,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...LIVE_STATUSES]),
        isNotNull(subscriptions.providerSubscriptionId),
        notInArray(subscriptions.billingProvider, [...LOCAL_PROVIDERS]),
      ),
    );
  return rows.map((r) => ({ ...r, providerSubscriptionId: r.providerSubscriptionId! }));
}

export async function deleteUserAccount(
  handle: Database,
  userId: string,
  deps: { cancelProviderSubscription: (sub: LiveProviderSubscription) => Promise<void> },
): Promise<DeleteAccountResult> {
  for (const sub of await liveProviderSubscriptions(handle, userId)) {
    try {
      // Immediate cancellation: the account (and its access) ends now.
      await deps.cancelProviderSubscription(sub);
    } catch {
      return { ok: false, code: "billing_cancel_failed" };
    }
  }

  await handle.transaction(async (tx) => {
    // Anonymise usage history before the user row (and its cascades) disappears.
    await tx.update(usageLogs).set({ userId: sql`gen_random_uuid()` }).where(eq(usageLogs.userId, userId));
    await tx.delete(usageDaily).where(eq(usageDaily.userId, userId));
    await tx.delete(virtualApiKeys).where(eq(virtualApiKeys.userId, userId));
    await tx.delete(devices).where(eq(devices.userId, userId));
    // Subscriptions, credit adjustments, sessions and auth rows cascade; audit rows
    // that name this user as the actor keep the entry with a NULL actor (0010).
    await tx.delete(users).where(eq(users.id, userId));
  });
  return { ok: true };
}
