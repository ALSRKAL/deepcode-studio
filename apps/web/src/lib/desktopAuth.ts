import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  desktopAuthCodes,
  devices,
  plans,
  subscriptions,
  users,
  virtualApiKeys,
  type Database,
} from "@deepcode/db";
import { generateVirtualKey, hashVirtualKey, virtualKeyDisplayParts } from "@deepcode/shared/node/keys";
import { env } from "./env";

/**
 * Desktop deep-link authentication, server side (docs/plan/03 §4.1, doc 00 §4.1).
 * The deep link carries a single-use 60-second code bound to a PKCE verifier held
 * only by the desktop app (doc 00, F3) — the code alone is worthless.
 */

export interface DesktopAuthStart {
  state: string;
  codeChallenge: string;
  deviceName: string;
  os: string;
  appVersion?: string;
}

export function codeHash(code: string): string {
  // Peppers the code hash like virtual keys, so a DB leak alone cannot mint codes.
  return createHmac("sha256", Buffer.from(env.KEY_HASH_PEPPER, "base64")).update(`dlink:${code}`).digest("hex");
}

/** Step 4: create the one-time code after the user approves the consent screen. */
export async function createDesktopAuthCode(handle: Database, userId: string, start: DesktopAuthStart) {
  const code = randomBytes(32).toString("base64url");
  const [row] = await handle
    .insert(desktopAuthCodes)
    .values({
      codeHash: codeHash(code),
      userId,
      state: start.state,
      codeChallenge: start.codeChallenge,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  return { code, state: start.state, row: row! };
}

export type ExchangeResult =
  | { ok: true; apiKey: string; user: { id: string; email: string; name: string | null; locale: string }; plan: { id: string; tier: string; nameEn: string; nameAr: string } }
  | { ok: false; code: "invalid_code" | "expired_code" | "used_code" | "pkce_mismatch" | "device_limit" };

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Step 6: POST /api/desktop/exchange. Consumes the code atomically, verifies PKCE,
 * enforces the plan device limit, and returns the device key exactly once.
 */
export async function exchangeDesktopCode(
  handle: Database,
  input: { code: string; codeVerifier: string; device: { name: string; os: string; appVersion?: string } },
): Promise<ExchangeResult> {
  return handle.transaction(async (tx) => {
    const hash = codeHash(input.code);
    // Atomic consume: one row, single use, not expired.
    const [auth] = await tx
      .update(desktopAuthCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(desktopAuthCodes.codeHash, hash),
          sql`${desktopAuthCodes.consumedAt} is null`,
          sql`${desktopAuthCodes.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!auth) {
      const [existing] = await tx.select().from(desktopAuthCodes).where(eq(desktopAuthCodes.codeHash, hash));
      if (!existing) return { ok: false as const, code: "invalid_code" as const };
      if (existing.consumedAt) return { ok: false as const, code: "used_code" as const };
      return { ok: false as const, code: "expired_code" as const };
    }

    const expected = Buffer.from(auth.codeChallenge);
    const given = Buffer.from(pkceChallenge(input.codeVerifier));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return { ok: false as const, code: "pkce_mismatch" as const };
    }

    const [user] = await tx.select().from(users).where(eq(users.id, auth.userId));
    if (!user || user.status !== "active") return { ok: false as const, code: "invalid_code" as const };

    // Review L11: serialize device creation per user so two parallel exchanges
    // cannot both pass the count check. Advisory lock releases at transaction end.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`device:${user.id}`}, 0))`);

    // Device limit from the live plan (docs/plan/03 §4.1 step 4).
    const [sub] = await tx
      .select({ s: subscriptions, p: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.userId, user.id),
          inArray(subscriptions.status, ["trialing", "active", "past_due"]),
        ),
      )
      .orderBy(sql`(${subscriptions.status} in ('trialing','active','past_due')) desc`, sql`${subscriptions.createdAt} desc`)
      .limit(1);
    const maxDevices = sub?.p.maxDevices ?? 1;
    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(eq(devices.userId, user.id));
    if (Number(countRows[0]!.count) >= maxDevices) {
      return { ok: false as const, code: "device_limit" as const };
    }

    const [device] = await tx
      .insert(devices)
      .values({ userId: user.id, name: input.device.name, os: input.device.os, appVersion: input.device.appVersion ?? null, lastSeenAt: new Date() })
      .returning();
    const apiKey = generateVirtualKey();
    await tx.insert(virtualApiKeys).values({
      userId: user.id,
      keyHash: hashVirtualKey(apiKey, Buffer.from(env.KEY_HASH_PEPPER, "base64")).toString("hex"),
      ...virtualKeyDisplayParts(apiKey),
      name: `Desktop — ${input.device.name}`.slice(0, 100),
      kind: "desktop",
      deviceId: device!.id,
    });
    return {
      ok: true as const,
      apiKey,
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
      plan: sub
        ? { id: sub.p.id, tier: sub.p.tier, nameEn: sub.p.nameEn, nameAr: sub.p.nameAr }
        : { id: "none", tier: "free", nameEn: "No plan", nameAr: "لا توجد خطة" },
    };
  });
}

/** The desktop sign-out call: revoke the key behind this Bearer device key. */
export async function revokeDeviceByKey(handle: Database, apiKey: string): Promise<string | null> {
  if (!apiKey.startsWith("sk-dc-")) return null;
  const hash = hashVirtualKey(apiKey, Buffer.from(env.KEY_HASH_PEPPER, "base64")).toString("hex");
  const [key] = await handle
    .update(virtualApiKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(virtualApiKeys.keyHash, hash), eq(virtualApiKeys.kind, "desktop"), eq(virtualApiKeys.status, "active")))
    .returning();
  if (!key) return null;
  if (key.deviceId) {
    await handle.delete(devices).where(eq(devices.id, key.deviceId));
  }
  return hash;
}
