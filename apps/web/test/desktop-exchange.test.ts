import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desktopAuthCodes, devices } from "@deepcode/db";
import { codeHash } from "@/lib/desktopAuth";
import { seedWorld } from "./helpers/world.js";

/**
 * W-03/W-04: the desktop exchange endpoint. Valid PKCE exchange succeeds exactly
 * once; code reuse, expired codes, wrong verifiers and device limits all fail.
 */
describe("desktop exchange (W-03, W-04)", () => {
  let world: Awaited<ReturnType<typeof seedWorld>>;

  beforeAll(async () => {
    world = await seedWorld();
  });

  afterAll(async () => {
    await world.handle.close();
  });

  const verifier = "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");

  function request(body: unknown, ip = "10.20.30.40"): Promise<Response> {
    // Route handlers are plain functions: a fresh Request is the whole contract.
    return import("@/app/api/desktop/exchange/route.js").then(({ POST }) =>
      POST(
        new Request("http://localhost:3210/api/desktop/exchange", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify(body),
        }),
      ),
    );
  }

  async function makeCode() {
    const code = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    await world.handle.db.insert(desktopAuthCodes).values({
      codeHash: codeHash(code),
      userId: world.user.id,
      state: `state-${randomUUID()}`,
      codeChallenge: challenge,
      expiresAt: new Date(Date.now() + 60_000),
    });
    return code;
  }

  let exchangedKey: string | null = null;

  it("W-03: a valid PKCE exchange succeeds and returns the key once", async () => {
    const code = await makeCode();
    const res = await request({ code, code_verifier: verifier, device: { name: "Test Laptop", os: "linux" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apiKey: string; plan: { tier: string } };
    expect(body.apiKey).toMatch(/^sk-dc-/);
    expect(body.plan.tier).toBe("pro");
    exchangedKey = body.apiKey;
    // Device + desktop key created.
    const devRows = await world.handle.db.select().from(devices).where(eq(devices.userId, world.user.id));
    expect(devRows).toHaveLength(1);

    // W-04: the same code cannot be used twice.
    const replay = await request({ code, code_verifier: verifier, device: { name: "Again", os: "linux" } });
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("used_code");
  });

  it("W-04: wrong verifier, unknown code and expired code are rejected", async () => {
    const wrongVerifier = await request({
      code: await makeCode(),
      code_verifier: "different-verifier-value-not-matching-sha256-at-all-99",
      device: { name: "X", os: "linux" },
    });
    expect(wrongVerifier.status).toBe(401);
    expect(((await wrongVerifier.json()) as { error: { code: string } }).error.code).toBe("pkce_mismatch");

    const unknown = await request({ code: randomUUID().replaceAll("-", "").repeat(2), code_verifier: verifier, device: { name: "X", os: "linux" } });
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe("invalid_code");

    // Expired: insert, then roll its expiry into the past.
    const code = await makeCode();
    await world.handle.db
      .update(desktopAuthCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(desktopAuthCodes.codeHash, codeHash(code)));
    const expired = await request({ code, code_verifier: verifier, device: { name: "X", os: "linux" } });
    expect(((await expired.json()) as { error: { code: string } }).error.code).toBe("expired_code");
  });

  it("W-04: the device limit is enforced by the plan", async () => {
    // The world already has 1 device from the W-03 test; plan maxDevices = 3.
    await world.handle.db.insert(devices).values({ userId: world.user.id, name: "d2", os: "linux" });
    await world.handle.db.insert(devices).values({ userId: world.user.id, name: "d3", os: "linux" });
    const code = await makeCode();
    const res = await request({ code, code_verifier: verifier, device: { name: "d4", os: "linux" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("device_limit");
  });

  it("W-04: exchanges are rate limited per IP", async () => {
    const ip = `10.77.${randomUUID().slice(0, 2)}.${randomUUID().slice(0, 2)}`;
    let status = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await request(
        { code: randomUUID().replaceAll("-", "").repeat(2), code_verifier: verifier, device: { name: "X", os: "linux" } },
        ip,
      );
      status = res.status;
    }
    expect(status).toBe(429);
    // A different real address (right-most, proxy-appended) has its own bucket.
    const other = await request({ code: "x".repeat(64), code_verifier: verifier, device: { name: "X", os: "linux" } }, "10.99.0.1");
    expect(other.status).not.toBe(429);
  });

  it("W-04: rotating client-written X-Forwarded-For entries does not escape the per-IP limit", async () => {
    const real = `10.78.${randomUUID().slice(0, 2)}.${randomUUID().slice(0, 2)}`;
    let status = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await request(
        { code: randomUUID().replaceAll("-", "").repeat(2), code_verifier: verifier, device: { name: "X", os: "linux" } },
        `198.51.100.${i}, ${real}`,
      );
      status = res.status;
    }
    expect(status).toBe(429);
  });

  it("DELETE /api/desktop/device revokes the Bearer device key", async () => {
    // The device limit is already reached in this world, so reuse the key the
    // W-03 exchange returned instead of minting another device.
    const { DELETE } = await import("@/app/api/desktop/device/route.js");
    expect(exchangedKey).toMatch(/^sk-dc-/);
    const del = await DELETE(
      new Request("http://localhost:3210/api/desktop/device", {
        method: "DELETE",
        headers: { authorization: `Bearer ${exchangedKey}` },
      }),
    );
    expect(del.status).toBe(200);
    const again = await DELETE(
      new Request("http://localhost:3210/api/desktop/device", {
        method: "DELETE",
        headers: { authorization: `Bearer ${exchangedKey}` },
      }),
    );
    expect(again.status).toBe(401);
  });
});
