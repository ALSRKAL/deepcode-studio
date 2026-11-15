import { and, desc, eq, gte, sql } from "drizzle-orm";
import { plans, subscriptions, usageDaily, usageLogs } from "@deepcode/db";
import { daysLeft, percentUsed, type SubscriptionStatusResponse } from "@deepcode/shared";
import { db } from "@/lib/db";

/** Server-side data access for the dashboard (docs/plan/03 §5). No content is
 * ever stored, so nothing here touches request payloads. */

export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatusResponse | null> {
  const [sub] = await db()
    .db.select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.userId, userId), sql`${subscriptions.status} in ('trialing','active','past_due','canceled')`))
    .orderBy(
      sql`(${subscriptions.status} in ('trialing','active','past_due')) desc`,
      sql`${subscriptions.createdAt} desc`,
    )
    .limit(1);
  if (!sub) return null;
  const now = new Date();
  const remaining = Math.max(0, sub.s.creditsLimit - sub.s.creditsUsed);
  const expired = sub.s.expiresAt.getTime() <= now.getTime();
  return {
    plan: { id: sub.p.id, tier: sub.p.tier, name: { en: sub.p.nameEn, ar: sub.p.nameAr } },
    status: sub.s.status,
    credits: {
      limit: sub.s.creditsLimit,
      used: sub.s.creditsUsed,
      remaining,
      percentUsed: percentUsed(sub.s.creditsUsed, sub.s.creditsLimit),
    },
    period: {
      startsAt: sub.s.currentPeriodStart.toISOString(),
      expiresAt: sub.s.expiresAt.toISOString(),
      daysLeft: Math.max(0, daysLeft(sub.s.expiresAt, now)),
    },
    limits: { rpm: sub.p.rpmLimit, allowedModels: sub.p.allowedModels },
    lock: null,
    serverTime: now.toISOString(),
    ...(expired ? {} : {}),
  };
}

export interface DailyUsage {
  day: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  creditsCharged: number;
}

export async function getDailyUsage(userId: string, days: number): Promise<DailyUsage[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db()
    .db.select()
    .from(usageDaily)
    .where(and(eq(usageDaily.userId, userId), gte(usageDaily.day, since)))
    .orderBy(desc(usageDaily.day));
  return rows.map((r) => ({
    day: String(r.day),
    model: r.model,
    requests: r.requests,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    creditsCharged: r.creditsCharged,
  }));
}

export interface RecentRequest {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  creditsCharged: number;
  status: string;
  estimated: boolean;
  durationMs: number | null;
  createdAt: Date;
}

export async function getRecentRequests(userId: string, limit: number, offset = 0): Promise<RecentRequest[]> {
  const rows = await db()
    .db.select({
      requestId: usageLogs.requestId,
      model: usageLogs.model,
      inputTokens: usageLogs.inputTokens,
      outputTokens: usageLogs.outputTokens,
      creditsCharged: usageLogs.creditsCharged,
      status: usageLogs.status,
      estimated: usageLogs.estimated,
      durationMs: usageLogs.durationMs,
      createdAt: usageLogs.createdAt,
    })
    .from(usageLogs)
    .where(eq(usageLogs.userId, userId))
    .orderBy(desc(usageLogs.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function countRequests(userId: string): Promise<number> {
  const rows = await db()
    .db.select({ count: sql<number>`count(*)::int` })
    .from(usageLogs)
    .where(eq(usageLogs.userId, userId));
  return Number(rows[0]!.count);
}

export function severityOf(status: SubscriptionStatusResponse | null): "ok" | "warn" | "critical" {
  if (!status) return "critical";
  if (status.credits.percentUsed >= 95 || status.period.daysLeft <= 3) return "critical";
  if (status.credits.percentUsed >= 80) return "warn";
  return "ok";
}

export function bannerOf(status: SubscriptionStatusResponse | null, _locale?: string): "none" | "warn80" | "warn95" | "expiringSoon" | "paymentFailed" | "expired" | "noSubscription" {
  if (!status) return "noSubscription";
  if (status.status === "past_due") return "paymentFailed";
  if (status.status === "canceled") return "expired";
  if (status.credits.percentUsed >= 95) return "warn95";
  if (status.period.daysLeft <= 3) return "expiringSoon";
  if (status.credits.percentUsed >= 80) return "warn80";
  return "none";
}
