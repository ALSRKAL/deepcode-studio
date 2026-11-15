import { and, eq, sql } from "drizzle-orm";
import { plans, subscriptions, virtualApiKeys, type Database } from "@deepcode/db";
import { generateVirtualKey, hashVirtualKey, virtualKeyDisplayParts } from "@deepcode/shared/node/keys";
import { env } from "./env";

/**
 * Virtual key lifecycle (docs/plan/03 §5, doc 00 ADR-006). Only the HMAC hash,
 * a prefix and the last four characters are ever stored; the full key is returned
 * exactly once by the caller (create/rotate) and never again.
 */
function pepper(): Buffer {
  return Buffer.from(env.KEY_HASH_PEPPER, "base64");
}

export interface LiveSubscription {
  sub: typeof subscriptions.$inferSelect;
  plan: typeof plans.$inferSelect;
}

/** Anything a transaction or a pooled handle can query with (same drizzle API). */
type Queryable = Pick<Database, "select" | "insert" | "update" | "execute">;

/** Live subscription first (trialing/active/past_due), else the most recent row. */
export async function liveSubscription(db: Queryable, userId: string): Promise<LiveSubscription | null> {
  const [row] = await db
    .select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.userId, userId))
    .orderBy(
      sql`(${subscriptions.status} in ('trialing','active','past_due')) desc`,
      sql`${subscriptions.createdAt} desc`,
    )
    .limit(1);
  return row ? { sub: row.s, plan: row.p } : null;
}

export async function countActiveKeys(db: Queryable, userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(virtualApiKeys)
    .where(and(eq(virtualApiKeys.userId, userId), eq(virtualApiKeys.status, "active")));
  return Number(rows[0]?.count ?? 0);
}

export interface CreateKeyResult {
  ok: true;
  key: string;
  record: { keyHash: string; keyPrefix: string; last4: string };
}
export type CreateKeyError = { ok: false; code: "max_keys" };
export type CreateKeyOutcome = CreateKeyResult | CreateKeyError;

export async function createApiKey(db: Database, userId: string, name: string): Promise<CreateKeyOutcome> {
  const key = generateVirtualKey();
  const keyHash = hashVirtualKey(key, pepper()).toString("hex");
  const display = virtualKeyDisplayParts(key);
  // Review L11: count and insert under one per-user advisory lock so parallel
  // creates cannot both pass the max-keys check.
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`key:${userId}`}, 0))`);
    const live = await liveSubscription(tx, userId);
    const maxKeys = live?.plan.maxKeys ?? 3;
    if ((await countActiveKeys(tx, userId)) >= maxKeys) return false;
    await tx.insert(virtualApiKeys).values({
      userId,
      keyHash,
      ...display,
      name,
      kind: "api",
    });
    return true;
  });
  if (!created) return { ok: false, code: "max_keys" };
  return { ok: true, key, record: { keyHash, ...display } };
}

export interface RotateOutcome {
  ok: boolean;
  code?: "not_found";
  /** Present exactly once after rotation. */
  key?: string;
  newKeyHash?: string;
  revokedHash?: string;
}

export async function rotateApiKey(db: Database, userId: string, keyId: string): Promise<RotateOutcome> {
  const [old] = await db
    .select()
    .from(virtualApiKeys)
    .where(and(eq(virtualApiKeys.id, keyId), eq(virtualApiKeys.userId, userId), eq(virtualApiKeys.status, "active")));
  if (!old) return { ok: false, code: "not_found" };

  const key = generateVirtualKey();
  const keyHash = hashVirtualKey(key, pepper()).toString("hex");
  const display = virtualKeyDisplayParts(key);
  await db.transaction(async (tx) => {
    await tx.insert(virtualApiKeys).values({
      userId,
      keyHash,
      ...display,
      name: old.name,
      kind: old.kind,
      deviceId: old.deviceId,
    });
    // Optional 24-hour overlap for API-kind keys (docs/plan/02 §4).
    const overlap = old.kind === "api" ? new Date(Date.now() + 24 * 3600_000) : new Date();
    await tx
      .update(virtualApiKeys)
      .set({ status: "revoked", revokedAt: new Date(), expiresAt: overlap })
      .where(eq(virtualApiKeys.id, old.id));
  });
  return { ok: true, key, newKeyHash: keyHash, revokedHash: old.keyHash };
}

export type RevokeOutcome = { ok: true; keyHash: string } | { ok: false; code: "not_found" };

export async function revokeApiKey(db: Database, userId: string, keyId: string): Promise<RevokeOutcome> {
  const [revoked] = await db
    .update(virtualApiKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(virtualApiKeys.id, keyId), eq(virtualApiKeys.userId, userId), eq(virtualApiKeys.status, "active")))
    .returning({ keyHash: virtualApiKeys.keyHash });
  if (!revoked) return { ok: false, code: "not_found" };
  return { ok: true, keyHash: revoked.keyHash };
}

/** Devices page: revoke every active key of one of the user's devices. */
export async function revokeKeysForDevice(db: Database, userId: string, deviceId: string): Promise<string[]> {
  const revoked = await db
    .update(virtualApiKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(virtualApiKeys.userId, userId),
        eq(virtualApiKeys.deviceId, deviceId),
        eq(virtualApiKeys.status, "active"),
      ),
    )
    .returning({ keyHash: virtualApiKeys.keyHash });
  return revoked.map((r) => r.keyHash);
}
