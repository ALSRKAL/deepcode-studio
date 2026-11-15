import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, subscriptions, users } from "@deepcode/db";
import { deleteUserAccount, type LiveProviderSubscription } from "@/lib/accountDeletion";
import { audit } from "@/lib/audit";
import { seedWorld } from "./helpers/world.js";

/**
 * Account deletion (review 2026-11-15): a paid subscription is cancelled at the
 * provider before any row is deleted; a provider failure deletes nothing; admins
 * with audit history can delete their account.
 */
describe("account deletion", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;

  beforeAll(async () => {
    world = await seedWorld();
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("cancels the provider subscription first, then deletes the user", async () => {
    await world.handle.db
      .update(subscriptions)
      .set({ billingProvider: "stripe", providerSubscriptionId: `sub_${world.id}` })
      .where(eq(subscriptions.id, world.sub.id));
    const cancelled: LiveProviderSubscription[] = [];

    const result = await deleteUserAccount(world.handle.db, world.user.id, {
      cancelProviderSubscription: async (sub) => void cancelled.push(sub),
    });

    expect(result).toEqual({ ok: true });
    expect(cancelled).toEqual([
      { id: world.sub.id, billingProvider: "stripe", providerSubscriptionId: `sub_${world.id}` },
    ]);
    expect(await world.handle.db.select().from(users).where(eq(users.id, world.user.id))).toHaveLength(0);
  });

  it("keeps the account when the provider cancellation fails", async () => {
    const other = await seedWorld();
    try {
      await other.handle.db
        .update(subscriptions)
        .set({ billingProvider: "stripe", providerSubscriptionId: `sub_fail_${other.id}` })
        .where(eq(subscriptions.id, other.sub.id));

      const result = await deleteUserAccount(other.handle.db, other.user.id, {
        cancelProviderSubscription: async () => {
          throw new Error("stripe down");
        },
      });

      expect(result).toEqual({ ok: false, code: "billing_cancel_failed" });
      expect(await other.handle.db.select().from(users).where(eq(users.id, other.user.id))).toHaveLength(1);
      const [sub] = await other.handle.db.select().from(subscriptions).where(eq(subscriptions.id, other.sub.id));
      expect(sub!.status).toBe("active");
    } finally {
      await other.handle.close();
    }
  });

  it("does not call the provider for manual or mock subscriptions", async () => {
    const other = await seedWorld();
    try {
      await other.handle.db
        .update(subscriptions)
        .set({ billingProvider: "mock", providerSubscriptionId: `mock-sub-${other.id}` })
        .where(eq(subscriptions.id, other.sub.id));
      let calls = 0;
      const result = await deleteUserAccount(other.handle.db, other.user.id, {
        cancelProviderSubscription: async () => void (calls += 1),
      });
      expect(result.ok).toBe(true);
      expect(calls).toBe(0);
    } finally {
      await other.handle.close();
    }
  });

  it("an admin with audit history can delete the account; the audit row stays with a NULL actor", async () => {
    const other = await seedWorld();
    try {
      await other.handle.db.update(users).set({ role: "admin" }).where(eq(users.id, other.user.id));
      await audit(other.handle.db, {
        actorId: other.user.id,
        action: "test.admin_action",
        targetType: "user",
        targetId: other.user.id,
      });

      const result = await deleteUserAccount(other.handle.db, other.user.id, {
        cancelProviderSubscription: async () => {},
      });

      expect(result.ok).toBe(true);
      const rows = await other.handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, other.user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorId).toBeNull();
    } finally {
      await other.handle.close();
    }
  });
});
