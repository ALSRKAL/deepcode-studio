import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, upstreamPoolKeys, upstreamProviders, users, virtualApiKeys } from "@deepcode/db";
import { addPoolKey, adjustCredits, assignPlan, revokeAllKeys, setUserStatus } from "@/lib/adminActions";
import { seedWorld } from "./helpers/world.js";
import { OPENCODE_GO_PROVIDER } from "@deepcode/db";

/** W-07/W-08: admin mutations — audit, creditsLimit adjustments, write-only keys. */
describe("admin mutations (W-07, W-08)", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;
  let admin: { id: string; ip?: string };

  beforeAll(async () => {
    world = await seedWorld();
    await world.handle.db.insert(upstreamProviders).values(OPENCODE_GO_PROVIDER).onConflictDoNothing();
    const [adminUser] = await world.handle.db
      .insert(users)
      .values({ email: `admin-${randomUUID().slice(0, 8)}@test.local`, emailVerified: true, role: "admin" })
      .returning();
    admin = { id: adminUser!.id, ip: "127.0.0.1" };
  });

  afterAll(async () => {
    await world.handle.close();
  });

  it("W-08: the pool key is stored encrypted; only the fingerprint is returned", async () => {
    const plaintext = "mock-upstream-key-never-displayed-123456";
    const outcome = await addPoolKey(world.handle.db, admin, {
      providerId: "opencode-go",
      label: "w08-key",
      plaintext,
    });
    expect(outcome.ok).toBe(true);
    const fingerprint = outcome.fingerprint!;
    expect(fingerprint).toHaveLength(8);
    const [row] = await world.handle.db.select().from(upstreamPoolKeys).where(eq(upstreamPoolKeys.label, "w08-key"));
    // The plaintext never reaches the database.
    expect(row!.keyCiphertext.toString("latin1")).not.toContain(plaintext);
    expect(row!.keyNonce.toString("latin1")).not.toContain(plaintext);
    expect(row!.keyFingerprint).toBe(fingerprint);
    // No column stores plaintext; the row JSON contains only ciphertext bytes.
    expect(JSON.stringify(row)).not.toContain(plaintext);
  });

  it("W-07: credit adjustment changes creditsLimit, writes the audit trail", async () => {
    const sub0 = await liveSubFor(world.user.id);
    const before = sub0!.creditsLimit;
    const outcome = await adjustCredits(world.handle.db, admin, {
      subscriptionId: sub0!.id,
      deltaCredits: 500_000,
      reason: "W-07 test adjustment",
    });
    expect(outcome.ok).toBe(true);
    const sub1 = await liveSubFor(world.user.id);
    expect(sub1!.creditsLimit).toBe(before + 500_000);
    // creditsUsed untouched: the gateway is the single writer.
    expect(sub1!.creditsUsed).toBe(sub0!.creditsUsed);
    const audits = await world.handle.db.select().from(auditLogs).where(eq(auditLogs.action, "subscription.credit_adjustment"));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.some((a) => a.metadata && (a.metadata as { deltaCredits?: number }).deltaCredits === 500_000)).toBe(true);
  });

  it("adjustment without a reason is rejected", async () => {
    const sub = await liveSubFor(world.user.id);
    const outcome = await adjustCredits(world.handle.db, admin, {
      subscriptionId: sub!.id,
      deltaCredits: 1,
      reason: "x",
    });
    expect(outcome.ok).toBe(false);
  });

  it("suspend → unsuspend works and never applies to the acting admin", async () => {
    const outcome = await setUserStatus(world.handle.db, admin, { userId: world.user.id, status: "suspended" });
    expect(outcome.ok).toBe(true);
    const [row] = await world.handle.db.select().from(users).where(eq(users.id, world.user.id));
    expect(row!.status).toBe("suspended");
    await setUserStatus(world.handle.db, admin, { userId: world.user.id, status: "active" });
    const self = await setUserStatus(world.handle.db, admin, { userId: admin.id, status: "suspended" });
    expect(self.ok).toBe(false);
    await setUserStatus(world.handle.db, admin, { userId: world.user.id, status: "active" });
  });

  it("assignPlan replaces the live subscription with a manual one", async () => {
    const outcome = await assignPlan(world.handle.db, admin, { userId: world.user.id, planId: world.plan.id, days: 14 });
    expect(outcome.ok).toBe(true);
    const sub = await liveSubFor(world.user.id);
    expect(sub!.billingProvider).toBe("manual");
    expect(sub!.expiresAt.getTime()).toBeLessThan(Date.now() + 15 * 86_400_000);
  });

  it("revokeAllKeys revokes every active key", async () => {
    const outcome = await revokeAllKeys(world.handle.db, admin, { userId: world.user.id });
    expect(outcome.ok).toBe(true);
    const rows = await world.handle.db.select().from(virtualApiKeys).where(eq(virtualApiKeys.userId, world.user.id));
    expect(rows.every((r) => r.status === "revoked")).toBe(true);
  });

  async function liveSubFor(userId: string) {
    const { liveSub } = await import("./helpers/world.js");
    return liveSub(world.handle, userId);
  }
});
