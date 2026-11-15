import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { inject } from "vitest";
import { createDatabase, plans, subscriptions, users } from "@deepcode/db";

/** Shared fixture world for the web API-surface tests (real Postgres + Redis). */
export async function seedWorld(planOverrides: Partial<typeof plans.$inferInsert> = {}) {
  const databaseUrl = inject("databaseUrl");
  const handle = createDatabase(databaseUrl, { max: 2 });
  const id = randomUUID().slice(0, 8);
  const [plan] = await handle.db
    .insert(plans)
    .values({
      id: `plan-${id}`,
      tier: "pro",
      nameEn: "Pro",
      nameAr: "احترافي",
      priceCents: 3000,
      creditsPerPeriod: 20_000_000,
      rpmLimit: 60,
      maxConcurrentStreams: 4,
      allowedModels: ["m-a"],
      ...planOverrides,
    })
    .returning();
  const [user] = await handle.db
    .insert(users)
    .values({ email: `w-${id}@test.local`, emailVerified: true, name: "Web Test", role: "user" })
    .returning();
  const now = Date.now();
  const [sub] = await handle.db
    .insert(subscriptions)
    .values({
      userId: user!.id,
      planId: plan!.id,
      status: "active",
      currentPeriodStart: new Date(now - 86_400_000),
      expiresAt: new Date(now + 30 * 86_400_000),
      creditsLimit: plan!.creditsPerPeriod,
    })
    .returning();
  return { handle, plan: plan!, user: user!, sub: sub!, id };
}

export async function liveSub(handle: ReturnType<typeof createDatabase>, userId: string) {
  // Live status first, newest first — matches the gateway's snapshot rules.
  const [sub] = await handle.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), sql`${subscriptions.status} in ('trialing','active','past_due','canceled')`))
    .orderBy(
      sql`(${subscriptions.status} in ('trialing','active','past_due')) desc`,
      sql`${subscriptions.createdAt} desc`,
    )
    .limit(1);
  return sub;
}
