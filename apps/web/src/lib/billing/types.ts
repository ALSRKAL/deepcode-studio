import { z } from "zod";

/**
 * Provider-neutral billing (docs/plan/03 §5.1). One adapter per provider selected
 * by BILLING_PROVIDER. Owner decision 2 (docs/plan/04 §3): Stripe test-mode adapter
 * plus a `mock` provider used by tests and local checkout. Never live keys.
 */

export type BillingEvent =
  | { type: "subscription.activated"; userId: string; planId: string; providerSubscriptionId: string; periodStart: string; periodEnd: string; providerEventId: string }
  | { type: "subscription.renewed"; providerSubscriptionId: string; periodStart: string; periodEnd: string; planId: string; userId: string; providerEventId: string }
  | { type: "subscription.past_due"; providerSubscriptionId: string; providerEventId: string }
  | { type: "subscription.canceled"; providerSubscriptionId: string; endsAt: string; providerEventId: string }
  | { type: "payment.refunded"; providerSubscriptionId: string; amountCents: number; providerEventId: string };

export interface CreateCheckoutInput {
  userId: string;
  planId: string;
  locale: "ar" | "en";
  successUrl: string;
  cancelUrl: string;
}

export interface BillingProvider {
  readonly id: "mock" | "stripe" | "upi";
  createCheckout(input: CreateCheckoutInput): Promise<{ url: string }>;
  createPortalSession?(userId: string): Promise<{ url: string }>;
  /** Verifies the signature on the RAW body; throws on any mismatch. */
  verifyAndParseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent>;
  cancel(subscriptionId: string, opts: { atPeriodEnd: boolean }): Promise<void>;
}

/** Payload of POST /api/webhooks/{mock,stripe} besides the signature header. */
export const WebhookBodySchema = z.object({
  eventId: z.string().min(6).max(200),
  type: z.string().min(3).max(100),
  payload: z.record(z.string(), z.unknown()),
});
export type WebhookBody = z.infer<typeof WebhookBodySchema>;
