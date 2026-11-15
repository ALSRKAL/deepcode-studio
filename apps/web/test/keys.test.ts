import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { virtualApiKeys } from "@deepcode/db";
import { createApiKey, revokeApiKey, rotateApiKey } from "@/lib/apiKeys";
import { seedWorld } from "./helpers/world.js";

/** W-05: shown-once keys; the DB holds only hash + prefix + last4. */
describe("api keys (W-05)", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;

  beforeAll(async () => {
    world = await seedWorld({ maxKeys: 2 });
  });

  afterAll(async () => {
    await world.handle.close();
  });

  it("create returns the full key once; storage holds only hash, prefix and last4", async () => {
    const outcome = await createApiKey(world.handle.db, world.user.id, "test key");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.key).toMatch(/^sk-dc-[A-Za-z0-9]{43}$/);
    const [row] = await world.handle.db.select().from(virtualApiKeys).where(eq(virtualApiKeys.keyHash, outcome.record.keyHash));
    expect(row).toBeTruthy();
    expect(row!.keyPrefix).toHaveLength(10);
    expect(row!.last4).toHaveLength(4);
    // No plaintext column exists; the hash never equals the key.
    expect(row!.keyHash).not.toContain(outcome.key.slice("sk-dc-".length));

    const max = await createApiKey(world.handle.db, world.user.id, "test key 2");
    expect(max.ok).toBe(true);
    const third = await createApiKey(world.handle.db, world.user.id, "third");
    expect(third.ok).toBe(false);
  });

  it("rotate revokes the old key (24 h overlap for api kind) and shows the new one once", async () => {
    const [active] = await world.handle.db
      .select()
      .from(virtualApiKeys)
      .where(eq(virtualApiKeys.userId, world.user.id))
      .limit(1);
    const outcome = await rotateApiKey(world.handle.db, world.user.id, active!.id);
    expect(outcome.ok).toBe(true);
    const [oldRow] = await world.handle.db.select().from(virtualApiKeys).where(eq(virtualApiKeys.id, active!.id));
    expect(oldRow!.status).toBe("revoked");
    expect(oldRow!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const [newRow] = await world.handle.db.select().from(virtualApiKeys).where(eq(virtualApiKeys.keyHash, outcome.newKeyHash!));
    expect(newRow!.status).toBe("active");
  });

  it("revoke takes the key out of rotation", async () => {
    const actives = await world.handle.db
      .select()
      .from(virtualApiKeys)
      .where(eq(virtualApiKeys.userId, world.user.id));
    const active = actives.find((r) => r.status === "active");
    expect(active).toBeTruthy();
    const outcome = await revokeApiKey(world.handle.db, world.user.id, active!.id);
    expect(outcome.ok).toBe(true);
    const [row] = await world.handle.db.select().from(virtualApiKeys).where(eq(virtualApiKeys.id, active!.id));
    expect(row!.status).toBe("revoked");
  });
});
