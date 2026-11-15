import { desc, eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { isWellFormedVirtualKey, hashVirtualKey } from "@deepcode/shared/node";
import type { LockReason, PlanTier, SubscriptionStatus } from "@deepcode/shared";
import { plans, subscriptions, users, virtualApiKeys, type Database } from "@deepcode/db";
import { GatewayHttpError } from "./errors.js";
import type { RedisScripts } from "./redisScripts.js";

export interface PlanSnapshot {
  id: string;
  tier: PlanTier;
  nameEn: string;
  nameAr: string;
  rpmLimit: number;
  maxConcurrentStreams: number;
  allowedModels: string[];
  maxOutputTokens: number | null;
  pastDueGraceHours: number;
  fallbackEnabled: boolean;
}

export interface SubscriptionSnapshot {
  id: string;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  expiresAt: number;
  creditsLimit: number;
  creditsUsed: number;
  plan: PlanSnapshot;
}

/** Everything authorisation needs, cached in Redis for 30 s under vk:{keyHash}. */
export interface AuthSnapshot {
  keyHash: string;
  keyId: string;
  keyStatus: "active" | "revoked";
  keyExpiresAt: number | null;
  userId: string;
  userStatus: "active" | "suspended";
  subscription: SubscriptionSnapshot | null;
}

const NEGATIVE = "none";
const NEGATIVE_TTL_SEC = 10;
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_LIMIT = 20;

export function snapshotKey(hash: string): string {
  return `vk:${hash}`;
}

/** Live subscription first (trialing/active/past_due), else the most recent one. */
async function loadSnapshot(db: Database, keyHash: string): Promise<AuthSnapshot | null> {
  const [row] = await db
    .select({ key: virtualApiKeys, userStatus: users.status })
    .from(virtualApiKeys)
    .innerJoin(users, eq(users.id, virtualApiKeys.userId))
    .where(eq(virtualApiKeys.keyHash, keyHash));
  if (!row) return null;

  const [sub] = await db
    .select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.userId, row.key.userId))
    .orderBy(
      desc(sql`(${subscriptions.status} in ('trialing', 'active', 'past_due'))`),
      desc(subscriptions.createdAt),
    )
    .limit(1);

  return {
    keyHash,
    keyId: row.key.id,
    keyStatus: row.key.status,
    keyExpiresAt: row.key.expiresAt?.getTime() ?? null,
    userId: row.key.userId,
    userStatus: row.userStatus,
    subscription: sub
      ? {
          id: sub.s.id,
          status: sub.s.status,
          currentPeriodStart: sub.s.currentPeriodStart.getTime(),
          expiresAt: sub.s.expiresAt.getTime(),
          creditsLimit: sub.s.creditsLimit,
          creditsUsed: sub.s.creditsUsed,
          plan: {
            id: sub.p.id,
            tier: sub.p.tier,
            nameEn: sub.p.nameEn,
            nameAr: sub.p.nameAr,
            rpmLimit: sub.p.rpmLimit,
            maxConcurrentStreams: sub.p.maxConcurrentStreams,
            allowedModels: sub.p.allowedModels,
            maxOutputTokens: sub.p.maxOutputTokens,
            pastDueGraceHours: sub.p.pastDueGraceHours,
            fallbackEnabled: sub.p.fallbackEnabled,
          },
        }
      : null,
  };
}

/** Extracts the key from the protocol-conventional headers. Query-string keys are refused. */
export function extractApiKey(req: Request): string | null {
  const url = new URL(req.url);
  if (url.searchParams.has("key") || url.searchParams.has("api_key")) {
    throw new GatewayHttpError("invalid_api_key", "API keys in the query string are not accepted. Use a header.");
  }
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-api-key")?.trim() || req.headers.get("x-goog-api-key")?.trim() || null;
}

export class Authenticator {
  constructor(
    private readonly deps: {
      db: Database;
      redis: Redis;
      scripts: RedisScripts;
      pepper: Buffer;
      snapshotTtlSec: number;
      now: () => number;
    },
  ) {}

  /**
   * Steps 1–3 of doc 02 §4: format, lookup (cached), key and user status.
   * The failed-attempt throttle runs only on the failure path: valid keys pay no
   * extra round trip, and a valid user behind the same IP as a guesser is not
   * locked out. Guessers get 429 after AUTH_FAIL_LIMIT failures per minute.
   */
  async authenticate(req: Request, clientIp: string): Promise<AuthSnapshot> {
    const failKey = `rl:authfail:${clientIp}`;
    const fail = async (err: GatewayHttpError): Promise<never> => {
      const now = this.deps.now();
      const [, , [, count]] = (await this.deps.redis
        .multi()
        .zremrangebyscore(failKey, "-inf", now - AUTH_FAIL_WINDOW_MS)
        .zadd(failKey, now, `${now}:${Math.random()}`)
        .zcard(failKey)
        .pexpire(failKey, AUTH_FAIL_WINDOW_MS)
        .exec()) as [unknown, unknown, [null, number], unknown];
      if (count > AUTH_FAIL_LIMIT) {
        throw new GatewayHttpError("rate_limited", "Too many failed authentication attempts.", { retryAfterSec: 60 });
      }
      throw err;
    };

    const key = extractApiKey(req);
    if (!key || !isWellFormedVirtualKey(key)) return fail(new GatewayHttpError("invalid_api_key"));

    const hash = hashVirtualKey(key, this.deps.pepper).toString("hex");
    const snapshot = await this.getSnapshot(hash);
    if (!snapshot) return fail(new GatewayHttpError("invalid_api_key"));

    const now = this.deps.now();
    if (
      snapshot.keyStatus !== "active" ||
      (snapshot.keyExpiresAt !== null && snapshot.keyExpiresAt <= now) ||
      snapshot.userStatus !== "active"
    ) {
      throw new GatewayHttpError("key_revoked");
    }
    return snapshot;
  }

  readonly #inflight = new Map<string, Promise<AuthSnapshot | null>>();

  async getSnapshot(hash: string): Promise<AuthSnapshot | null> {
    const cached = await this.deps.redis.get(snapshotKey(hash));
    if (cached === NEGATIVE) return null;
    if (cached) return JSON.parse(cached) as AuthSnapshot;
    // Single flight: when a hot key's snapshot expires, one query refills it for
    // every concurrent request instead of one query each.
    let pending = this.#inflight.get(hash);
    if (!pending) {
      pending = this.#loadAndCache(hash).finally(() => this.#inflight.delete(hash));
      this.#inflight.set(hash, pending);
    }
    return pending;
  }

  async #loadAndCache(hash: string): Promise<AuthSnapshot | null> {
    const snapshot = await loadSnapshot(this.deps.db, hash);
    if (!snapshot) {
      await this.deps.redis.set(snapshotKey(hash), NEGATIVE, "EX", NEGATIVE_TTL_SEC);
      return null;
    }
    await this.deps.redis
      .multi()
      .set(snapshotKey(hash), JSON.stringify(snapshot), "EX", this.deps.snapshotTtlSec)
      .sadd(`vkuser:${snapshot.userId}`, hash)
      .expire(`vkuser:${snapshot.userId}`, 3600)
      .exec();
    return snapshot;
  }

  /** After settlement: write the authoritative balance into the cached snapshot. */
  async updateCachedCredits(hash: string, creditsUsed: number, creditsLimit: number): Promise<void> {
    const cached = await this.deps.redis.get(snapshotKey(hash));
    if (!cached || cached === NEGATIVE) return;
    const snapshot = JSON.parse(cached) as AuthSnapshot;
    if (!snapshot.subscription) return;
    snapshot.subscription.creditsUsed = creditsUsed;
    snapshot.subscription.creditsLimit = creditsLimit;
    await this.deps.redis.set(snapshotKey(hash), JSON.stringify(snapshot), "KEEPTTL");
  }

  async invalidate(options: { keyHashes?: string[]; userIds?: string[] }): Promise<number> {
    const hashes = new Set(options.keyHashes ?? []);
    for (const userId of options.userIds ?? []) {
      for (const h of await this.deps.redis.smembers(`vkuser:${userId}`)) hashes.add(h);
      await this.deps.redis.del(`vkuser:${userId}`);
    }
    if (hashes.size === 0) return 0;
    return this.deps.redis.del(...[...hashes].map(snapshotKey));
  }
}

// ---- subscription rules (doc 02 §4 step 4, §8 lock) ---------------------------

export function remainingCredits(sub: SubscriptionSnapshot): number {
  return sub.creditsLimit - sub.creditsUsed;
}

/** Why the user cannot make model requests right now, or null if they can. */
export function lockReason(snapshot: AuthSnapshot, now: number): LockReason | null {
  if (snapshot.userStatus !== "active") return "suspended";
  const sub = snapshot.subscription;
  if (!sub) return "expired";
  if (sub.status === "expired") return "expired";
  if (sub.status === "past_due") {
    if (now >= sub.expiresAt + sub.plan.pastDueGraceHours * 3_600_000) return "payment_failed";
  } else if (now >= sub.expiresAt) {
    return "expired";
  }
  if (remainingCredits(sub) <= 0) return "quota_exhausted";
  return null;
}

export function renewUrl(webOrigin: string, reason: LockReason): string {
  return `${webOrigin}/dashboard/billing?reason=${reason}`;
}

/** Step 4 + 6 as errors. */
export function assertCanSpend(snapshot: AuthSnapshot, now: number, webOrigin: string): SubscriptionSnapshot {
  const reason = lockReason(snapshot, now);
  if (reason === "quota_exhausted") {
    throw new GatewayHttpError("quota_exhausted", undefined, { renewUrl: renewUrl(webOrigin, reason) });
  }
  if (reason === "suspended") throw new GatewayHttpError("key_revoked", "This account is suspended.");
  if (reason) {
    throw new GatewayHttpError("subscription_expired", undefined, { renewUrl: renewUrl(webOrigin, reason) });
  }
  return snapshot.subscription!;
}
