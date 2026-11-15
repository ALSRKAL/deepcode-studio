import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { billingSessions, plans, subscriptions, type Database } from "@deepcode/db";
import { env, mockBillingAllowed } from "../env";
import type { BillingEvent, BillingProvider, CreateCheckoutInput, WebhookBody } from "./types";

/**
 * Local checkout + tests (owner decision 2, docs/plan/04 §3): the "payment" page
 * is a plain server page; approving it produces a signed webhook that flows through
 * the same idempotent handler as a real provider's.
 */
export class MockBillingProvider implements BillingProvider {
  readonly id = "mock" as const;

  constructor(private readonly deps: { db: Database; appUrl: string }) {}

  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string }> {
    if (!mockBillingAllowed()) {
      // Review H1: mock checkout must never grant paid plans on a public deploy.
      throw new Error("mock billing is disabled in this environment");
    }
    const [session] = await this.deps.db
      .insert(billingSessions)
      .values({ userId: input.userId, planId: input.planId, provider: "mock", locale: input.locale })
      .returning();
    const url = new URL(`/${input.locale}/mock-billing`, this.deps.appUrl);
    url.searchParams.set("session", session!.id);
    return { url: url.toString() };
  }

  /** Called by the mock-billing page's server action (CSRF-checked there). */
  async completeCheckout(sessionId: string, userId: string): Promise<{ applied: boolean }> {
    if (!mockBillingAllowed()) return { applied: false };
    const [session] = await this.deps.db
      .select()
      .from(billingSessions)
      .where(and(eq(billingSessions.id, sessionId), eq(billingSessions.userId, userId)));
    if (!session || session.status !== "pending") return { applied: false };
    const [plan] = await this.deps.db.select().from(plans).where(eq(plans.id, session.planId));
    if (!plan) return { applied: false };
    const now = new Date();
    const periodEnd = new Date(now.getTime() + (plan.interval === "year" ? 365 : 30) * 86_400_000);
    const event: BillingEvent = {
      type: "subscription.activated",
      userId: session.userId,
      planId: session.planId,
      providerSubscriptionId: `mock-sub-${randomUUID()}`,
      periodStart: now.toISOString(),
      periodEnd: periodEnd.toISOString(),
      providerEventId: `mock-evt-${randomUUID()}`,
    };
    await this.deps.db
      .update(billingSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(billingSessions.id, sessionId));
    // Delivered through the same signed-webhook endpoint a real provider uses,
    // so idempotency and signature handling are exercised locally too.
    const body: WebhookBody = { eventId: event.providerEventId, type: event.type, payload: event as unknown as Record<string, unknown> };
    await postSelfWebhook(body);
    return { applied: true };
  }

  async verifyAndParseWebhook(rawBody: string, signature: string | null): Promise<BillingEvent> {
    // Same gate as checkout (review H1 follow-up): a production deploy that is not
    // explicitly opted in accepts no mock events, even with a leaked secret.
    if (!mockBillingAllowed() || !env.MOCK_BILLING_WEBHOOK_SECRET || !signature) throw new Error("bad_signature");
    const expected = createHmac("sha256", env.MOCK_BILLING_WEBHOOK_SECRET).update(rawBody).digest("hex");
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new Error("bad_signature");
    const body = JSON.parse(rawBody) as WebhookBody & { payload: BillingEvent };
    if (body.payload.providerEventId !== body.eventId) throw new Error("bad_request");
    return body.payload;
  }

  async cancel(subscriptionId: string, opts: { atPeriodEnd: boolean }): Promise<void> {
    const [sub] = await this.deps.db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
    if (!sub?.providerSubscriptionId) return;
    const event: BillingEvent = {
      type: "subscription.canceled",
      providerSubscriptionId: sub.providerSubscriptionId,
      endsAt: (opts.atPeriodEnd ? sub.expiresAt : new Date()).toISOString(),
      providerEventId: `mock-evt-${randomUUID()}`,
    };
    await postSelfWebhook({ eventId: event.providerEventId, type: event.type, payload: event as unknown as Record<string, unknown> });
  }
}

async function postSelfWebhook(body: WebhookBody): Promise<void> {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", env.MOCK_BILLING_WEBHOOK_SECRET ?? "").update(raw).digest("hex");
  const res = await fetch(new URL("/api/webhooks/mock", env.APP_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": sig },
    body: raw,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`mock webhook failed: ${res.status}`);
}
