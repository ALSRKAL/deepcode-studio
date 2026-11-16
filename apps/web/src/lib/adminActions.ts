import { and, eq, inArray, sql } from "drizzle-orm";
import {
  auditLogs,
  creditAdjustments,
  plans,
  subscriptions,
  upstreamPoolKeys,
  upstreamProviders,
  users,
  virtualApiKeys,
  type Database,
} from "@deepcode/db";
import { z } from "zod";
import { insertPoolKey } from "./poolKeys";
import { invalidateGateway } from "./gateway";
import { audit } from "./audit";
import { deleteUserAccount } from "./accountDeletion";

/**
 * Admin mutations (docs/plan/03 §6). Every one is zod-checked, audited, and
 * invalidates the gateway cache where balances are cached. Lives in a lib module
 * so the invariants are testable without a Next request context; the server
 * actions supply the authenticated admin and the IP.
 */

export type AdminOutcome = { ok: true } | { ok: false; code: string };

export async function addPoolKey(
  db: Database,
  admin: { id: string; ip?: string },
  input: { providerId: string; label: string; plaintext: string; weight?: number; maxConcurrency?: number },
): Promise<AdminOutcome & { fingerprint?: string }> {
  const parsed = z
    .object({
      providerId: z.string().min(1).max(100),
      label: z.string().trim().min(1).max(100),
      plaintext: z.string().trim().min(8).max(400),
      weight: z.coerce.number().int().min(1).max(100).default(1),
      maxConcurrency: z.coerce.number().int().min(1).max(64).default(8),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const [provider] = await db.select().from(upstreamProviders).where(eq(upstreamProviders.id, parsed.data.providerId));
  if (!provider) return { ok: false, code: "unknown_provider" };
  const row = await insertPoolKey(db, {
    providerId: parsed.data.providerId,
    label: parsed.data.label,
    plaintext: parsed.data.plaintext,
    weight: parsed.data.weight,
    maxConcurrency: parsed.data.maxConcurrency,
  });
  await audit(db, {
    actorId: admin.id,
    action: "pool_key.create",
    targetType: "upstream_pool_key",
    targetId: row.id,
    metadata: { label: parsed.data.label, fingerprint: row.keyFingerprint },
    ip: admin.ip,
  });
  await invalidateGateway({ reloadPool: true });
  return { ok: true, fingerprint: row.keyFingerprint };
}

export async function setPoolKeyStatus(
  db: Database,
  admin: { id: string; ip?: string },
  input: { keyId: string; status: "active" | "disabled" },
): Promise<AdminOutcome> {
  const parsed = z
    .object({ keyId: z.string().uuid(), status: z.enum(["active", "disabled"]) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  await db
    .update(upstreamPoolKeys)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(upstreamPoolKeys.id, parsed.data.keyId));
  await audit(db, {
    actorId: admin.id,
    action: `pool_key.${parsed.data.status}`,
    targetType: "upstream_pool_key",
    targetId: parsed.data.keyId,
    ip: admin.ip,
  });
  await invalidateGateway({ reloadPool: true });
  return { ok: true };
}

/** Adjustments change creditsLimit so creditsUsed keeps a single writer (doc 02 §6.2). */
export async function adjustCredits(
  db: Database,
  admin: { id: string; ip?: string },
  input: { subscriptionId: string; deltaCredits: number; reason: string },
): Promise<AdminOutcome & { userId?: string }> {
  const parsed = z
    .object({
      subscriptionId: z.string().uuid(),
      deltaCredits: z.coerce.number().int().min(-1_000_000_000).max(1_000_000_000),
      reason: z.string().trim().min(3).max(500),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };

  const userId = await db.transaction(async (tx) => {
    const [sub] = await tx
      .update(subscriptions)
      .set({ creditsLimit: sql`${subscriptions.creditsLimit} + ${parsed.data.deltaCredits}`, updatedAt: new Date() })
      .where(eq(subscriptions.id, parsed.data.subscriptionId))
      .returning({ userId: subscriptions.userId });
    if (!sub) return null;
    await tx.insert(creditAdjustments).values({
      subscriptionId: parsed.data.subscriptionId,
      deltaCredits: parsed.data.deltaCredits,
      reason: parsed.data.reason,
      adminId: admin.id,
    });
    return sub.userId;
  });
  if (!userId) return { ok: false, code: "not_found" };

  await audit(db, {
    actorId: admin.id,
    action: "subscription.credit_adjustment",
    targetType: "subscription",
    targetId: parsed.data.subscriptionId,
    metadata: { deltaCredits: parsed.data.deltaCredits, reason: parsed.data.reason },
    ip: admin.ip,
  });
  await invalidateGateway({ userIds: [userId] });
  return { ok: true, userId };
}

export async function setUserStatus(
  db: Database,
  admin: { id: string; ip?: string },
  input: { userId: string; status: "active" | "suspended" },
): Promise<AdminOutcome> {
  const parsed = z
    .object({ userId: z.string().uuid(), status: z.enum(["active", "suspended"]) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  if (parsed.data.userId === admin.id) return { ok: false, code: "cannot_self" };
  await db.update(users).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(users.id, parsed.data.userId));
  await audit(db, {
    actorId: admin.id,
    action: `user.${parsed.data.status}`,
    targetType: "user",
    targetId: parsed.data.userId,
    ip: admin.ip,
  });
  await invalidateGateway({ userIds: [parsed.data.userId] });
  return { ok: true };
}

export async function assignPlan(
  db: Database,
  admin: { id: string; ip?: string },
  input: { userId: string; planId: string; days?: number },
): Promise<AdminOutcome> {
  const parsed = z
    .object({ userId: z.string().uuid(), planId: z.string().min(1).max(100), days: z.coerce.number().int().min(1).max(3650).default(30) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const [plan] = await db.select().from(plans).where(eq(plans.id, parsed.data.planId));
  if (!plan) return { ok: false, code: "unknown_plan" };

  const now = new Date();
  const expires = new Date(now.getTime() + parsed.data.days * 86_400_000);
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ status: "canceled", updatedAt: now })
      .where(
        and(
          eq(subscriptions.userId, parsed.data.userId),
          inArray(subscriptions.status, ["trialing", "active", "past_due"]),
        ),
      );
    await tx.insert(subscriptions).values({
      userId: parsed.data.userId,
      planId: plan.id,
      status: "active",
      currentPeriodStart: now,
      expiresAt: expires,
      creditsLimit: plan.creditsPerPeriod,
      billingProvider: "manual",
      providerSubscriptionId: `manual-${admin.id.slice(0, 8)}`,
    });
  });
  await audit(db, {
    actorId: admin.id,
    action: "subscription.assign_plan",
    targetType: "user",
    targetId: parsed.data.userId,
    metadata: { planId: plan.id, days: parsed.data.days },
    ip: admin.ip,
  });
  await invalidateGateway({ userIds: [parsed.data.userId] });
  return { ok: true };
}

export async function revokeAllKeys(
  db: Database,
  admin: { id: string; ip?: string },
  input: { userId: string },
): Promise<AdminOutcome & { count?: number }> {
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const revoked = await db
    .update(virtualApiKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(virtualApiKeys.userId, parsed.data.userId), eq(virtualApiKeys.status, "active")))
    .returning({ keyHash: virtualApiKeys.keyHash });
  await audit(db, {
    actorId: admin.id,
    action: "user.revoke_all_keys",
    targetType: "user",
    targetId: parsed.data.userId,
    metadata: { count: revoked.length },
    ip: admin.ip,
  });
  await invalidateGateway({ userIds: [parsed.data.userId] });
  return { ok: true, count: revoked.length };
}

export async function recentAudit(db: Database, limit = 100) {
  return db.select().from(auditLogs).orderBy(sql`${auditLogs.createdAt} desc`).limit(limit);
}

/**
 * Admin: delete a user account entirely so the person can sign up again as new
 * (owner request 2026-11-16). The admin must type the account's email to confirm.
 * Admin accounts (including the acting admin) are never deleted here. Paid provider
 * subscriptions are cancelled first (lib/accountDeletion.ts); the audit row is
 * written before the delete so it survives with the target id.
 */
export async function adminDeleteUser(
  db: Database,
  admin: { id: string; ip?: string },
  input: { userId: string; confirmEmail: string },
  deps: Parameters<typeof deleteUserAccount>[2],
): Promise<AdminOutcome> {
  const parsed = z.object({ userId: z.string().uuid(), confirmEmail: z.string().trim().min(3) }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const [target] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, parsed.data.userId));
  if (!target) return { ok: false, code: "not_found" };
  if (target.email.toLowerCase() !== parsed.data.confirmEmail.toLowerCase()) return { ok: false, code: "confirm_mismatch" };
  if (target.id === admin.id || target.role === "admin") return { ok: false, code: "cannot_delete_admin" };
  await audit(db, {
    actorId: admin.id,
    action: "user.delete",
    targetType: "user",
    targetId: target.id,
    metadata: { email: target.email },
    ip: admin.ip,
  });
  const result = await deleteUserAccount(db, target.id, deps);
  if (!result.ok) return { ok: false, code: result.code };
  await invalidateGateway({ userIds: [target.id] });
  return { ok: true };
}
