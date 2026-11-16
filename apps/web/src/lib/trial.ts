import { and, eq } from "drizzle-orm";
import { plans, subscriptions, TRIAL_HOURS, TRIAL_PLAN, type Database } from "@deepcode/db";
import { env } from "./env";

/**
 * Free trial for new accounts (owner decision 2026-11-16): 24 hours on the cheap,
 * high-quota models (TRIAL_PLAN), then the account must subscribe. Started once per
 * account, at creation (email or Google). Off when TRIAL_ENABLED=false.
 * Returns true when a trial was started.
 */
export async function startTrialForNewUser(db: Database, userId: string, now = new Date()): Promise<boolean> {
  if (!env.TRIAL_ENABLED) return false;
  const [plan] = await db.select().from(plans).where(eq(plans.id, TRIAL_PLAN.id));
  if (!plan) return false;
  // Never a second trial, and never on top of any existing subscription.
  const [existing] = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (existing) return false;
  await db
    .insert(subscriptions)
    .values({
      userId,
      planId: plan.id,
      status: "trialing",
      currentPeriodStart: now,
      expiresAt: new Date(now.getTime() + TRIAL_HOURS * 3_600_000),
      creditsLimit: plan.creditsPerPeriod,
      billingProvider: "manual",
      providerSubscriptionId: `trial-${userId.slice(0, 8)}`,
    })
    .onConflictDoNothing();
  return true;
}

/** True while the user has a live trial (pricing page / dashboard copy). */
export async function hasLiveTrial(db: Database, userId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ expiresAt: subscriptions.expiresAt })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "trialing")))
    .limit(1);
  return Boolean(row && row.expiresAt > now);
}
