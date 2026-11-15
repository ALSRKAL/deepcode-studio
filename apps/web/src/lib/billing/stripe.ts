import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { plans, type Database } from "@deepcode/db";
import { env } from "../env";
import type { BillingEvent, BillingProvider, CreateCheckoutInput } from "./types";

/**
 * Stripe adapter — TEST MODE ONLY (owner decision 2, docs/plan/04 §3). Keys are
 * optional; without them the adapter is never constructed. Webhook signatures are
 * verified against the raw body by the Stripe SDK.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly id = "stripe" as const;
  readonly #stripe: Stripe;

  constructor(private readonly deps: { db: Database }) {
    if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required for the Stripe adapter");
    // Test mode is enforced at startup: live keys are never accepted (docs/plan §7).
    if (env.STRIPE_SECRET_KEY.includes("live")) throw new Error("Live Stripe keys are not allowed");
    this.#stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string }> {
    const [plan] = await this.deps.db.select().from(plans).where(eq(plans.id, input.planId));
    if (!plan?.providerPriceId) {
      throw new Error(`plan ${input.planId} has no providerPriceId configured`);
    }
    const session = await this.#stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.providerPriceId, quantity: 1 }],
      client_reference_id: input.userId,
      customer_email: undefined, // collected by Stripe Checkout
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { locale: input.locale, planId: input.planId, userId: input.userId },
    });
    if (!session.url) throw new Error("Stripe checkout returned no URL");
    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const customer = await this.#findCustomer(userId);
    const session = await this.#stripe.billingPortal.sessions.create({
      customer,
      return_url: `${env.APP_URL}/dashboard/billing`,
    });
    return { url: session.url };
  }

  async verifyAndParseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent> {
    if (!env.STRIPE_WEBHOOK_SECRET || !signature) throw new Error("bad_signature");
    const stripeEvent = this.#stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    return mapStripeEvent(stripeEvent);
  }

  async cancel(subscriptionId: string, opts: { atPeriodEnd: boolean }): Promise<void> {
    await this.#stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: opts.atPeriodEnd,
    });
  }

  async #findCustomer(userId: string): Promise<string> {
    const found = await this.#stripe.customers.search({ query: `metadata["userId"]:"${userId}"` });
    const customer = found.data[0]?.id;
    if (!customer) throw new Error("no Stripe customer for this user");
    return customer;
  }
}

/** Maps Stripe events onto the provider-neutral BillingEvent union. */
export function mapStripeEvent(ev: Stripe.Event): BillingEvent {
  const sub = ev.data.object as Stripe.Subscription & { metadata?: Record<string, string> };
  const period = sub.items?.data?.[0];
  const periodStart = period?.current_period_start
    ? new Date(period.current_period_start * 1000).toISOString()
    : new Date().toISOString();
  const periodEnd = period?.current_period_end
    ? new Date(period.current_period_end * 1000).toISOString()
    : new Date(Date.now() + 30 * 86_400_000).toISOString();

  switch (ev.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = ev.data.object as Stripe.Checkout.Session;
      // Review L7: never activate before funds settle. With async payment methods
      // (e.g. bank debits) checkout.session.completed can arrive with
      // payment_status="unpaid"; only activation on a paid session is honoured.
      const paymentStatus = (session as unknown as { payment_status?: string }).payment_status;
      if (paymentStatus !== "paid") {
        throw new Error(`checkout session is not paid: ${session.id} (${paymentStatus ?? "unknown"})`);
      }
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const planId = session.metadata?.planId;
      if (!userId || !planId) throw new Error(`checkout.session.completed without user/plan: ${session.id}`);
      return {
        type: "subscription.activated",
        userId,
        planId,
        providerSubscriptionId: String(session.subscription ?? session.id),
        periodStart,
        periodEnd,
        providerEventId: `stripe-${ev.id}`,
      };
    }
    case "checkout.session.async_payment_failed": {
      const session = ev.data.object as Stripe.Checkout.Session;
      const subscriptionId = String(session.subscription ?? session.id);
      return {
        type: "subscription.past_due",
        providerSubscriptionId: subscriptionId,
        providerEventId: `stripe-${ev.id}`,
      };
    }
    case "invoice.paid":
      return {
        type: "subscription.renewed",
        providerSubscriptionId: ((ev.data.object as unknown as { subscription?: string | null }).subscription ?? "").toString(),
        periodStart,
        periodEnd,
        planId: "",
        userId: "",
        providerEventId: `stripe-${ev.id}`,
      };
    case "invoice.payment_failed":
      return {
        type: "subscription.past_due",
        providerSubscriptionId: ((ev.data.object as unknown as { subscription?: string | null }).subscription ?? "").toString(),
        providerEventId: `stripe-${ev.id}`,
      };
    case "customer.subscription.deleted":
      return {
        type: "subscription.canceled",
        providerSubscriptionId: sub.id,
        endsAt: sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : new Date().toISOString(),
        providerEventId: `stripe-${ev.id}`,
      };
    case "charge.refunded": {
      const charge = ev.data.object as unknown as { subscription?: string | null; customer?: string | null; amount_refunded?: number };
      return {
        type: "payment.refunded",
        providerSubscriptionId: String(charge.subscription ?? charge.customer ?? ""),
        amountCents: charge.amount_refunded ?? 0,
        providerEventId: `stripe-${ev.id}`,
      };
    }
    default:
      throw new Error(`unhandled stripe event ${ev.type}`);
  }
}
