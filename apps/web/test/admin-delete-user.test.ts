import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, devices, subscriptions, users, virtualApiKeys } from "@deepcode/db";
import { adminDeleteUser } from "@/lib/adminActions";
import { seedWorld } from "./helpers/world.js";

/** Owner request 2026-11-16: the admin deletes an account so the person can start over. */
describe("admin deletes a user account", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;
  let admin: { id: string; email: string; ip?: string };
  const noCancel = { cancelProviderSubscription: async () => {} };

  beforeAll(async () => {
    world = await seedWorld();
    const [row] = await world.handle.db
      .insert(users)
      .values({ email: `admin-${randomUUID().slice(0, 8)}@test.local`, emailVerified: true, role: "admin" })
      .returning();
    admin = { id: row!.id, email: row!.email, ip: "127.0.0.1" };
  });
  afterAll(async () => {
    await world.handle.close();
  });

  it("refuses when the typed email does not match", async () => {
    const out = await adminDeleteUser(world.handle.db, admin, { userId: world.user.id, confirmEmail: "someone@else.test" }, noCancel);
    expect(out).toEqual({ ok: false, code: "confirm_mismatch" });
    expect(await world.handle.db.select().from(users).where(eq(users.id, world.user.id))).toHaveLength(1);
  });

  it("never deletes an admin account, including the acting admin", async () => {
    const out = await adminDeleteUser(world.handle.db, admin, { userId: admin.id, confirmEmail: admin.email }, noCancel);
    expect(out).toEqual({ ok: false, code: "cannot_delete_admin" });
  });

  it("stops before deleting anything when the provider cancel fails", async () => {
    await world.handle.db
      .update(subscriptions)
      .set({ billingProvider: "stripe", providerSubscriptionId: `sub_${world.id}` })
      .where(eq(subscriptions.id, world.sub.id));
    const out = await adminDeleteUser(
      world.handle.db,
      admin,
      { userId: world.user.id, confirmEmail: world.user.email },
      { cancelProviderSubscription: async () => { throw new Error("provider down"); } },
    );
    expect(out).toEqual({ ok: false, code: "billing_cancel_failed" });
    expect(await world.handle.db.select().from(users).where(eq(users.id, world.user.id))).toHaveLength(1);
  });

  it("deletes the user, keys, devices and subscriptions, and audits it", async () => {
    const out = await adminDeleteUser(
      world.handle.db,
      admin,
      { userId: world.user.id, confirmEmail: ` ${world.user.email.toUpperCase()} ` },
      noCancel,
    );
    expect(out).toEqual({ ok: true });
    const db = world.handle.db;
    expect(await db.select().from(users).where(eq(users.id, world.user.id))).toHaveLength(0);
    expect(await db.select().from(subscriptions).where(eq(subscriptions.userId, world.user.id))).toHaveLength(0);
    expect(await db.select().from(virtualApiKeys).where(eq(virtualApiKeys.userId, world.user.id))).toHaveLength(0);
    expect(await db.select().from(devices).where(eq(devices.userId, world.user.id))).toHaveLength(0);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.targetId, world.user.id));
    expect(audits.some((a) => a.action === "user.delete" && a.actorId === admin.id)).toBe(true);
  });

  it("the same email can sign up again as a brand-new user", async () => {
    const [again] = await world.handle.db.insert(users).values({ email: world.user.email, emailVerified: false }).returning();
    expect(again!.id).not.toBe(world.user.id);
  });
});
