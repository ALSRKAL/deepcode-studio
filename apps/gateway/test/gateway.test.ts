import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayErrorSchema, SubscriptionStatusResponseSchema, USAGE_HEADERS, uuidv7 } from "@deepcode/shared";
import { catalogModels, modelRoutes, upstreamPoolKeys, upstreamProviders, usageDaily, usageLogs, users, virtualApiKeys } from "@deepcode/db";
import { encryptPoolKey } from "@deepcode/shared/node/pool-crypto";
import { settleBatch, type SettlementRecord } from "../src/metering.js";
import {
  balance,
  call,
  createTenant,
  EXPECTED_CREDITS,
  sleep,
  splitNotice,
  startHarness,
  type Harness,
  type Proto,
} from "./helpers/harness.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

async function errorOf(res: Response) {
  const body = GatewayErrorSchema.parse(await res.json());
  return { status: res.status, code: body.error.code, body };
}

async function usageRow(requestId: string) {
  const [row] = await h.gw.deps.db.select().from(usageLogs).where(eq(usageLogs.requestId, requestId));
  return row;
}

describe("authentication and authorisation", () => {
  it("G-02: missing, malformed and unknown keys are 401 invalid_api_key", async () => {
    const t = await createTenant(h);
    expect((await errorOf(await call(h, t, "chat", { key: null }))).code).toBe("invalid_api_key");
    expect((await errorOf(await call(h, t, "chat", { key: "sk-dc-short" }))).code).toBe("invalid_api_key");
    const unknown = `sk-dc-${"A".repeat(43)}`;
    const r = await errorOf(await call(h, t, "chat", { key: unknown }));
    expect(r).toMatchObject({ status: 401, code: "invalid_api_key" });
  });

  it("refuses keys in the query string", async () => {
    const t = await createTenant(h);
    const res = await h.gw.app.request(`/v1/chat/completions?key=${t.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": t.ip },
      body: JSON.stringify({ model: t.models[0] }),
    });
    expect((await errorOf(res)).code).toBe("invalid_api_key");
  });

  it("throttles repeated failed authentication per client IP without locking out valid keys", async () => {
    const t = await createTenant(h);
    for (let i = 0; i < 20; i += 1) {
      expect((await errorOf(await call(h, t, "chat", { key: "sk-dc-bad" }))).code).toBe("invalid_api_key");
    }
    const r = await errorOf(await call(h, t, "chat", { key: "sk-dc-bad" }));
    expect(r).toMatchObject({ status: 429, code: "rate_limited" });
    // A valid key from the same address (shared NAT) still works.
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
  });

  it("the failed-auth throttle keys on the proxy-appended address, not client-written X-Forwarded-For entries", async () => {
    const t = await createTenant(h);
    // A guesser rotates the left-most entry; our proxy appends the real address last.
    const spoofed = (i: number) => ({ headers: { "x-forwarded-for": `203.0.113.${i}, ${t.ip}` } });
    for (let i = 0; i < 20; i += 1) {
      expect((await errorOf(await call(h, t, "chat", { key: "sk-dc-bad", ...spoofed(i) }))).code).toBe("invalid_api_key");
    }
    const r = await errorOf(await call(h, t, "chat", { key: "sk-dc-bad", ...spoofed(99) }));
    expect(r).toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("G-03: revoked key and suspended user are 401 key_revoked", async () => {
    const a = await createTenant(h);
    await h.gw.deps.db.update(virtualApiKeys).set({ status: "revoked" }).where(eq(virtualApiKeys.id, a.keyId));
    expect((await errorOf(await call(h, a, "chat"))).code).toBe("key_revoked");

    const b = await createTenant(h, { user: { status: "suspended" } });
    expect((await errorOf(await call(h, b, "chat"))).code).toBe("key_revoked");
  });

  it("G-04: expired subscription is 402; past_due works inside the grace window only", async () => {
    const expired = await createTenant(h, { subscription: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await errorOf(await call(h, expired, "chat"));
    expect(r).toMatchObject({ status: 402, code: "subscription_expired" });
    expect(r.body.error.renewUrl).toContain("/dashboard/billing");

    const grace = await createTenant(h, {
      subscription: { status: "past_due", expiresAt: new Date(Date.now() - 3_600_000) },
      plan: { pastDueGraceHours: 72 },
    });
    expect((await call(h, grace, "chat", { stream: false })).status).toBe(200);

    const late = await createTenant(h, {
      subscription: { status: "past_due", expiresAt: new Date(Date.now() - 100 * 3_600_000) },
      plan: { pastDueGraceHours: 72 },
    });
    expect((await errorOf(await call(h, late, "chat"))).code).toBe("subscription_expired");
  });

  it("G-05: a model outside the plan is 403 model_not_allowed", async () => {
    const t = await createTenant(h);
    expect((await errorOf(await call(h, t, "chat", { model: "some-other-model" }))).code).toBe("model_not_allowed");
  });

  it("G-06: zero remaining credits is 402 quota_exhausted with a renew link", async () => {
    const t = await createTenant(h, { subscription: { creditsLimit: 500, creditsUsed: 500 } });
    const r = await errorOf(await call(h, t, "chat"));
    expect(r).toMatchObject({ status: 402, code: "quota_exhausted" });
    expect(r.body.error.renewUrl).toBeDefined();
  });

  it("G-07: requests over the RPM limit are 429 with Retry-After", async () => {
    const t = await createTenant(h, { plan: { rpmLimit: 3 } });
    for (let i = 0; i < 3; i += 1) expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get(USAGE_HEADERS.rateLimitRemaining)).toBe("0");
  });
});

describe("streaming and metering", () => {
  const protos: Proto[] = ["chat", "anthropic", "responses", "google"];

  for (const proto of protos) {
    it(`${proto}: streams, settles exactly, and reports the balance (G-11, G-12, G-25)`, async () => {
      const t = await createTenant(h);
      const before = await balance(h, t.subscriptionId);
      const res = await call(h, t, proto);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      for (const name of [USAGE_HEADERS.creditsRemaining, USAGE_HEADERS.usagePercentage, USAGE_HEADERS.subscriptionExpires, USAGE_HEADERS.planName, USAGE_HEADERS.requestId]) {
        expect(res.headers.get(name), name).toBeTruthy();
      }
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("x-upstream-account")).toBeNull();

      const text = await res.text();
      const { content, notice } = splitNotice(text);
      expect(notice).not.toBeNull();
      expect(notice!.creditsCharged).toBe(EXPECTED_CREDITS);
      expect(notice!.estimated).toBe(false);
      expect(notice!.tokens).toMatchObject({ input: 120, cachedInput: 20, output: 30 });

      const after = await balance(h, t.subscriptionId);
      expect(after.creditsUsed - before.creditsUsed).toBe(EXPECTED_CREDITS);
      expect(notice!.creditsRemaining).toBe(after.creditsLimit - after.creditsUsed);

      // Byte-identical passthrough, apart from the chunk the gateway asked for itself.
      const upstream = h.mock.raw.get(t.poolSecrets[0]!)!;
      const expected = proto === "chat" ? upstream.split("\n\n").filter((e) => !e.includes('"choices":[]')).join("\n\n") : upstream;
      expect(content).toBe(expected);
      // The usage notice comes before the terminal event.
      if (proto === "chat") expect(text.indexOf("deepcode-usage")).toBeLessThan(text.indexOf("[DONE]"));
      if (proto === "anthropic") expect(text.indexOf("deepcode-usage")).toBeLessThan(text.indexOf("message_stop"));

      const row = await usageRow(notice!.requestId);
      expect(row).toMatchObject({ status: "ok", creditsCharged: EXPECTED_CREDITS, inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, estimated: false });
      const [daily] = await h.gw.deps.db.select().from(usageDaily).where(eq(usageDaily.userId, t.userId));
      expect(daily).toMatchObject({ requests: 1, creditsCharged: EXPECTED_CREDITS });
    });

    it(`${proto}: non-streaming responses are metered and carry post-request headers`, async () => {
      const t = await createTenant(h);
      const res = await call(h, t, proto, { stream: false });
      expect(res.status).toBe(200);
      await res.json();
      const after = await balance(h, t.subscriptionId);
      expect(after.creditsUsed).toBe(EXPECTED_CREDITS);
      expect(res.headers.get(USAGE_HEADERS.creditsRemaining)).toBe(String(after.creditsLimit - after.creditsUsed));
    });
  }

  it("G-10: include_usage is injected upstream and the extra chunk is withheld; kept when the client asked", async () => {
    const t = await createTenant(h);
    const text = await (await call(h, t, "chat")).text();
    expect(h.mock.requestsFor(t.poolSecrets[0]!)[0]!.body.stream_options).toEqual({ include_usage: true });
    expect(text).not.toContain('"choices":[]');

    const t2 = await createTenant(h);
    const text2 = await (await call(h, t2, "chat", { body: { stream_options: { include_usage: true } } })).text();
    expect(text2).toContain('"choices":[]');
  });

  it("drops an optional parameter the upstream model rejects and retries once on the same key", async () => {
    const t = await createTenant(h);
    const secret = t.poolSecrets[0]!;
    h.mock.script(secret, {
      status: 400,
      body: JSON.stringify({ error: { code: "unsupported_parameter", message: "Unrecognized request argument supplied: thinking" } }),
    });
    const res = await call(h, t, "chat", { stream: false, body: { thinking: { type: "enabled" } } });
    expect(res.status).toBe(200);
    const sent = h.mock.requestsFor(secret);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body.thinking).toEqual({ type: "enabled" });
    expect(sent[1]!.body).not.toHaveProperty("thinking");
  });

  it("does not drop required fields named in an upstream 400", async () => {
    const t = await createTenant(h);
    h.mock.script(t.poolSecrets[0]!, {
      status: 400,
      body: JSON.stringify({ error: { message: "Unrecognized request argument supplied: messages" } }),
    });
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(400);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("frames correctly when upstream delivers one byte at a time", async () => {
    const t = await createTenant(h);
    h.mock.script(t.poolSecrets[0]!, { byteByByte: true });
    const { notice, content } = splitNotice(await (await call(h, t, "anthropic")).text());
    expect(notice!.creditsCharged).toBe(EXPECTED_CREDITS);
    expect(content).toBe(h.mock.raw.get(t.poolSecrets[0]!));
  });

  it("sends the pool key, our user agent and a stable session id upstream, never the client key", async () => {
    const t = await createTenant(h);
    await (await call(h, t, "chat")).text();
    await (await call(h, t, "chat")).text();
    const [r1, r2] = h.mock.requestsFor(t.poolSecrets[0]!);
    expect(r1!.headers.authorization).toBe(`Bearer ${t.poolSecrets[0]}`);
    expect(JSON.stringify(r1!.headers)).not.toContain(t.apiKey);
    expect(r1!.headers["user-agent"]).toMatch(/^DeepCodeStudio-Gateway\//);
    expect(r1!.headers["x-forwarded-for"]).toBeUndefined();
    expect(r1!.headers["x-opencode-session"]).toMatch(/^[0-9a-f]{32}$/);
    expect(r1!.headers["x-opencode-session"]).toBe(r2!.headers["x-opencode-session"]);
    expect(r1!.body.model).toBe(`${t.models[0]}-upstream`);
  });

  it("forwards anthropic-version and clamps max_tokens to the plan cap", async () => {
    const t = await createTenant(h, { plan: { maxOutputTokens: 256 } });
    await (await call(h, t, "anthropic", { body: { max_tokens: 9999 } })).text();
    const req = h.mock.requestsFor(t.poolSecrets[0]!)[0]!;
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.body.max_tokens).toBe(256);
  });

  it("G-13: 50 concurrent completions on one subscription settle to the exact sum", async () => {
    const t = await createTenant(h, { keys: [{ maxConcurrency: 100 }] });
    const results = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const res = await call(h, t, "chat", { stream: false });
        await res.text();
        return res.status;
      }),
    );
    expect(results.every((s) => s === 200)).toBe(true);
    // Responses are released after at most settleWaitMs; slower settlements finish in
    // the background. The balance must converge to the exact sum, with nothing lost.
    const deadline = Date.now() + 15_000;
    let used = 0;
    while (Date.now() < deadline) {
      used = (await balance(h, t.subscriptionId)).creditsUsed;
      if (used >= 50 * EXPECTED_CREDITS) break;
      await sleep(100);
    }
    expect(used).toBe(50 * EXPECTED_CREDITS);
    const rows = await h.gw.deps.db.select().from(usageLogs).where(eq(usageLogs.subscriptionId, t.subscriptionId));
    expect(rows).toHaveLength(50);
  });

  it("G-14 / G-15: settlement is idempotent, including through the retry queue", async () => {
    const t = await createTenant(h);
    const rec: SettlementRecord = {
      requestId: uuidv7(),
      createdAt: new Date().toISOString(),
      userId: t.userId,
      keyId: t.keyId,
      keyHash: t.keyHash,
      subscriptionId: t.subscriptionId,
      poolKeyId: t.poolKeyIds[0]!,
      providerId: t.providerId,
      model: t.models[0],
      apiType: "openai-chat-completions",
      usage: { input: 120, cachedInput: 20, output: 30, reasoning: 0 },
      credits: EXPECTED_CREDITS,
      estimated: false,
      status: "ok",
      httpStatus: 200,
      ttfbMs: 5,
      durationMs: 10,
      retries: 0,
    };
    // Live path: write-ahead, batched commit, stream entry removed afterwards.
    const balanceAfter = await h.gw.deps.settlement.submit(rec);
    expect(balanceAfter?.creditsUsed).toBe(EXPECTED_CREDITS);
    // Replays through the batch, a direct call and the drainer are all no-ops.
    await h.gw.deps.settlement.submit(rec);
    await settleBatch(h.gw.deps.db, [rec, rec]);
    await h.gw.deps.redis.xadd("settle:pending", "*", "rec", JSON.stringify(rec));
    await h.gw.deps.settlement.drain(0);
    expect((await balance(h, t.subscriptionId)).creditsUsed).toBe(EXPECTED_CREDITS);
    expect(await h.gw.deps.settlement.depth()).toBe(0);
    const rows = await h.gw.deps.db.select().from(usageLogs).where(eq(usageLogs.requestId, rec.requestId));
    expect(rows).toHaveLength(1);
  });

  it("a poison record is dead-lettered without blocking the rest of its batch", async () => {
    const t = await createTenant(h);
    const make = (status: string): SettlementRecord => ({
      requestId: uuidv7(),
      createdAt: new Date().toISOString(),
      userId: t.userId,
      keyId: t.keyId,
      keyHash: t.keyHash,
      subscriptionId: t.subscriptionId,
      poolKeyId: null,
      providerId: null,
      model: t.models[0],
      apiType: "openai-chat-completions",
      usage: { input: 120, cachedInput: 20, output: 30, reasoning: 0 },
      credits: EXPECTED_CREDITS,
      estimated: false,
      status: status as SettlementRecord["status"],
      httpStatus: 200,
      ttfbMs: 1,
      durationMs: 1,
      retries: 0,
    });
    const deadBefore = await h.gw.deps.settlement.deadLetterDepth();
    // Submitted together, so they land in the same batch.
    const [good, bad] = await Promise.all([h.gw.deps.settlement.submit(make("ok")), h.gw.deps.settlement.submit(make("not-a-status"))]);
    expect(good?.creditsUsed).toBe(EXPECTED_CREDITS);
    expect(bad).toBeNull();
    expect(await h.gw.deps.settlement.deadLetterDepth()).toBe(deadBefore + 1);
    expect(await h.gw.deps.settlement.depth()).toBe(0);
    expect(h.logs.some((l) => l.includes("moved to dead letter") && l.includes('"alert":true'))).toBe(true);
  });

  it("G-16: client abort stops the upstream request and settles an estimate", async () => {
    const t = await createTenant(h);
    h.mock.script(t.poolSecrets[0]!, { hang: true });
    const res = await call(h, t, "chat");
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await sleep(100);
    expect(h.mock.aborted).toContain(t.poolSecrets[0]);
    const [row] = await h.gw.deps.db.select().from(usageLogs).where(eq(usageLogs.subscriptionId, t.subscriptionId));
    expect(row).toMatchObject({ status: "client_abort", estimated: true });
    expect(row!.creditsCharged).toBeGreaterThan(0);
    // Slot, reservation and in-flight entries are released.
    expect(await h.gw.deps.redis.zcard(`cc:${t.subscriptionId}`)).toBe(0);
    expect(await h.gw.deps.redis.hlen(`rsv:${t.subscriptionId}`)).toBe(0);
    expect(await h.gw.deps.redis.zcard(`pool:inflight:${t.poolKeyIds[0]}`)).toBe(0);
  });

  it("G-17: an upstream that omits usage is charged an estimate and flagged", async () => {
    const t = await createTenant(h);
    h.mock.script(t.poolSecrets[0]!, { omitUsage: true });
    const { notice } = splitNotice(await (await call(h, t, "anthropic")).text());
    expect(notice!.estimated).toBe(true);
    expect((await usageRow(notice!.requestId))!.estimated).toBe(true);
    expect(h.logs.some((l) => l.includes("charged an estimate"))).toBe(true);
  });

  it("G-08: reservations stop parallel requests from overspending the last credits", async () => {
    const t = await createTenant(h, { subscription: { creditsLimit: 100 }, keys: [{ maxConcurrency: 50 }] });
    for (let i = 0; i < 10; i += 1) h.mock.script(t.poolSecrets[0]!, { hang: true });
    const responses = await Promise.all(Array.from({ length: 10 }, () => call(h, t, "chat")));
    const ok = responses.filter((r) => r.status === 200);
    const rejected = responses.filter((r) => r.status === 402);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of ok) await r.body!.cancel();
    for (const r of rejected) await r.text();
  });
});

describe("upstream key pool", () => {
  it("G-18: a 429 cools that key for that model only and the request is served by another key", async () => {
    const t = await createTenant(h, { keys: [{ weight: 100 }, { weight: 1 }] });
    const [a, b] = t.poolSecrets as [string, string];
    h.mock.script(a, { status: 429, headers: { "retry-after": "30" } });
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(200);
    expect(h.mock.requestsFor(a)).toHaveLength(1);
    expect(h.mock.requestsFor(b)).toHaveLength(1);
    const ttl = await h.gw.deps.redis.pttl(`pool:mcool:${t.poolKeyIds[0]}:${t.models[0]}`);
    expect(ttl).toBeGreaterThan(25_000);
    expect(ttl).toBeLessThanOrEqual(30_000);
    // The same key still serves a different model.
    expect((await call(h, t, "chat", { stream: false, model: t.models[1] })).status).toBe(200);
    expect(h.mock.requestsFor(a).at(-1)!.body.model).toBe(`${t.models[1]}-upstream`);
  });

  it("G-19: 5xx cools the whole key with exponential backoff; the next request after cooldown probes and success closes the breaker", async () => {
    const t = await createTenant(h, { keys: [{}, {}] });
    const pk = (await h.gw.deps.pool.select(t.providerId, t.models[0], "probe", new Set()))!;
    if (!pk.key) throw new Error("no key");
    await pk.release();
    const first = await h.gw.deps.pool.recordFailure(pk.key, "http_503");
    const second = await h.gw.deps.pool.recordFailure(pk.key, "http_503");
    expect(first).toBe(5_000);
    expect(second).toBe(10_000);
    // The key is not selectable while cooling (the other key still serves, so exclude it).
    const others = new Set(t.poolKeyIds.filter((id) => id !== pk.key.id));
    expect((await h.gw.deps.pool.select(t.providerId, t.models[0], "probe2", others)).key).toBeNull();
    // Half-open probe (docs/plan/02 §10): when the cooldown expires, the next real
    // request is let through; success resets the failure count and closes the breaker.
    await h.gw.deps.redis.del(`pool:cool:${pk.key.id}`);
    const probe = await h.gw.deps.pool.select(t.providerId, t.models[0], "probe3", others);
    if (!probe.key) throw new Error("expected the cooled key to be probeable after cooldown");
    expect(probe.key.id).toBe(pk.key.id);
    await probe.release();
    await h.gw.deps.pool.recordSuccess(pk.key, t.models[0]);
    expect(await h.gw.deps.redis.exists(`pool:fail:${pk.key.id}`)).toBe(0);
    expect((await h.gw.deps.pool.select(t.providerId, t.models[0], "probe4", others)).key).not.toBeNull();
  });

  // Customer report 2026-11-18: "Type validation failed … expected array, received
  // undefined" — Synthetic answered 200 with {"error":"Error from inference backend: …"}.
  const BACKEND_ERROR = { error: "Error from inference backend: Internal server error" };
  const sseData = (v: unknown) => `data: ${typeof v === "string" ? v : JSON.stringify(v)}\n\n`;

  it("a 200 JSON body that is only a backend error is retried on the same (only) key", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { json: BACKEND_ERROR });
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices?: unknown[] };
    expect(Array.isArray(body.choices)).toBe(true);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(2);
    expect(await h.gw.deps.redis.exists(`pool:cool:${t.poolKeyIds[0]}`)).toBe(0);
  });

  it("a stream whose first event is a backend error is retried before any byte reaches the client", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { events: [sseData(BACKEND_ERROR)] });
    const res = await call(h, t, "chat");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("inference backend");
    expect(text).toContain("chat.completion.chunk");
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(2);
  });

  it("an upstream 5xx is retried on the only key without cooling it", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { status: 500, body: JSON.stringify(BACKEND_ERROR) });
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(2);
    expect(await h.gw.deps.redis.exists(`pool:cool:${t.poolKeyIds[0]}`)).toBe(0);
  });

  it("when the backend keeps failing, the client gets an OpenAI-shaped 503 it can retry", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { json: BACKEND_ERROR }, { json: BACKEND_ERROR }, { json: BACKEND_ERROR });
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(typeof body.error).toBe("object");
    expect(body.error?.code).toBe("upstream_unavailable");
  });

  it("a backend error after output started is rewritten into the OpenAI error object", async () => {
    const t = await createTenant(h, { keys: [{}] });
    const first = sseData({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] });
    h.mock.script(t.poolSecrets[0]!, { events: [first, sseData(BACKEND_ERROR)] });
    const text = await (await call(h, t, "chat")).text();
    expect(text).toContain('"content":"Hi"');
    expect(text).toContain('"error":{"message":"Error from inference backend: Internal server error"');
    expect(text).not.toContain('"error":"Error from inference backend');
  });

  it("a model that is slower than the stream start window gets a retryable 503 and the only key is not cooled", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { delayMs: 6_000 });
    const res = await call(h, t, "chat");
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("upstream_unavailable");
    expect(await h.gw.deps.redis.exists(`pool:cool:${t.poolKeyIds[0]}`)).toBe(0);
    // The next request is served normally.
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
  }, 20_000);

  it("G-20: a 401 from upstream removes the key, alerts, and retries on another key", async () => {
    const t = await createTenant(h, { keys: [{ weight: 100 }, { weight: 1 }] });
    h.mock.script(t.poolSecrets[0]!, { status: 401 });
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    const [row] = await h.gw.deps.db.select().from(upstreamPoolKeys).where(eq(upstreamPoolKeys.id, t.poolKeyIds[0]!));
    expect(row!.status).toBe("auth_failed");
    expect(h.logs.some((l) => l.includes("authentication failed") && l.includes('"alert":true'))).toBe(true);
    await (await call(h, t, "chat", { stream: false })).text();
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("G-21: when every key is cooling, the client gets 503 with the soonest Retry-After", async () => {
    const t = await createTenant(h, { keys: [{}, {}] });
    h.mock.script(t.poolSecrets[0]!, { status: 429, headers: { "retry-after": "40" } });
    h.mock.script(t.poolSecrets[1]!, { status: 429, headers: { "retry-after": "20" } });
    expect((await call(h, t, "chat", { stream: false })).status).toBe(503);
    const res = await call(h, t, "chat", { stream: false });
    const r = await errorOf(res);
    expect(r).toMatchObject({ status: 503, code: "upstream_unavailable" });
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(15);
    expect(retryAfter).toBeLessThanOrEqual(20);
  });

  it("G-22: a stream that breaks after the first byte is not retried and ends with an error event", async () => {
    const t = await createTenant(h, { keys: [{}, {}] });
    h.mock.script(t.poolSecrets[0]!, { cutAfter: 2 });
    h.mock.script(t.poolSecrets[1]!, { cutAfter: 2 });
    const res = await call(h, t, "chat");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Upstream stream interrupted");
    expect(h.mock.requests.filter((r) => t.poolSecrets.includes(r.secret))).toHaveLength(1);
    const [row] = await h.gw.deps.db.select().from(usageLogs).where(eq(usageLogs.subscriptionId, t.subscriptionId));
    expect(row).toMatchObject({ status: "upstream_error", estimated: true });
  });

  it("idle keys are chosen by weight, deterministically", async () => {
    const t = await createTenant(h, { keys: [{ weight: 1 }, { weight: 5 }, { weight: 2 }] });
    for (let i = 0; i < 5; i += 1) {
      const sel = await h.gw.deps.pool.select(t.providerId, t.models[0], `w-${i}`, new Set());
      if (!sel.key) throw new Error("no key");
      expect(sel.key.id).toBe(t.poolKeyIds[1]);
      await sel.release();
    }
  });

  it("G-23: least-loaded selection never exceeds a key's max concurrency", async () => {
    const t = await createTenant(h, { keys: [{ maxConcurrency: 2 }, { maxConcurrency: 2 }] });
    for (const s of t.poolSecrets) for (let i = 0; i < 3; i += 1) h.mock.script(s, { hang: true });
    const open = await Promise.all(Array.from({ length: 4 }, () => call(h, t, "chat")));
    expect(open.every((r) => r.status === 200)).toBe(true);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(2);
    expect(h.mock.requestsFor(t.poolSecrets[1]!)).toHaveLength(2);
    const fifth = await call(h, t, "chat");
    expect((await errorOf(fifth)).code).toBe("upstream_unavailable");
    for (const r of open) await r.body!.cancel();
  });

  it("G-24: fallback providers are used only when the plan allows it", async () => {
    const noFb = await createTenant(h, { fallbackKeys: 1 });
    // The primary keeps failing (a single 5xx is now retried on the same key).
    h.mock.script(noFb.poolSecrets[0]!, { status: 503 }, { status: 503 }, { status: 503 });
    expect((await call(h, noFb, "chat", { stream: false })).status).toBe(503);
    expect(h.mock.requestsFor(noFb.fallbackSecrets[0]!)).toHaveLength(0);

    const withFb = await createTenant(h, { fallbackKeys: 1, plan: { fallbackEnabled: true } });
    h.mock.script(withFb.poolSecrets[0]!, { status: 503 }, { status: 503 }, { status: 503 });
    expect((await call(h, withFb, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(withFb.fallbackSecrets[0]!)[0]!.body.model).toBe(`${withFb.models[0]}-fallback`);
  });
});

describe("routing across subscriptions by remaining quota (2026-11-21)", () => {
  async function addPeerProvider(t: Awaited<ReturnType<typeof createTenant>>) {
    const db = h.gw.deps.db;
    const peerId = `peer-${t.providerId}`;
    const base = h.mock.url;
    await db.insert(upstreamProviders).values({
      id: peerId,
      displayName: peerId,
      baseUrls: { "openai-chat-completions": `${base}/openai/v1` },
    });
    for (const m of t.models) {
      await db.insert(modelRoutes).values({ model: m, providerId: peerId, apiType: "openai-chat-completions", upstreamModel: `${m}-peer` });
    }
    const secret = `mock-upstream-key-peer-${randomUUID()}`;
    const [row] = await db
      .insert(upstreamPoolKeys)
      .values({ providerId: peerId, label: "peer", ...encryptPoolKey(secret, h.config.encryptionKey) })
      .returning();
    return { peerSecret: secret, peerKeyId: row!.id };
  }

  async function setQuota(keyId: string, pct: number | null) {
    await h.gw.deps.db.update(upstreamPoolKeys).set({ quotaRemainingPct: pct }).where(eq(upstreamPoolKeys.id, keyId));
  }

  it("G-40: skips a nearly used-up subscription, keeps the user there after, and moves them when it runs low", async () => {
    const t = await createTenant(h);
    const { peerSecret, peerKeyId } = await addPeerProvider(t);

    // Primary nearly out of weekly credit, peer healthy: the request goes to the peer.
    await setQuota(t.poolKeyIds[0]!, 5);
    await setQuota(peerKeyId, 70);
    await h.gw.deps.pool.reload();
    await h.gw.deps.catalog.reload();
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(peerSecret)).toHaveLength(1);
    expect(h.mock.requestsFor(peerSecret)[0]!.body.model).toBe(`${t.models[0]}-peer`);

    // Primary recovers with more headroom, peer still healthy: the user stays (prompt cache).
    await setQuota(t.poolKeyIds[0]!, 90);
    await setQuota(peerKeyId, 40);
    await h.gw.deps.pool.reload();
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(peerSecret)).toHaveLength(2);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(0);

    // The peer drops under 10%: the user moves to the primary.
    await setQuota(peerKeyId, 6);
    await h.gw.deps.pool.reload();
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("G-41: an exhausted subscription still serves when it is the only one left", async () => {
    const t = await createTenant(h);
    await setQuota(t.poolKeyIds[0]!, 1);
    await h.gw.deps.pool.reload();
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("G-42: a 429 on one subscription fails over to the other in the same request", async () => {
    const t = await createTenant(h);
    const { peerSecret, peerKeyId } = await addPeerProvider(t);
    await setQuota(t.poolKeyIds[0]!, 80);
    await setQuota(peerKeyId, 20);
    await h.gw.deps.pool.reload();
    await h.gw.deps.catalog.reload();
    h.mock.script(t.poolSecrets[0]!, { status: 429, headers: { "retry-after": "60" } });
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    expect(h.mock.requestsFor(peerSecret)).toHaveLength(1);
  });
});

describe("subscription status and cache invalidation", () => {
  it("G-26: status for active, exhausted, expired and suspended accounts", async () => {
    const get = (t: { apiKey: string; ip: string }) =>
      h.gw.app.request("/v1/subscription/status", { headers: { authorization: `Bearer ${t.apiKey}`, "x-forwarded-for": t.ip } });

    const active = await createTenant(h, { subscription: { creditsLimit: 1000, creditsUsed: 371 } });
    const a = SubscriptionStatusResponseSchema.parse(await (await get(active)).json());
    expect(a).toMatchObject({ status: "active", lock: null, credits: { remaining: 629, percentUsed: 37.1 } });
    expect(a.period.daysLeft).toBe(30);
    expect(a.limits.allowedModels).toEqual(active.models);

    const exhausted = await createTenant(h, { subscription: { creditsLimit: 10, creditsUsed: 10 } });
    expect(SubscriptionStatusResponseSchema.parse(await (await get(exhausted)).json()).lock?.reason).toBe("quota_exhausted");

    const expired = await createTenant(h, { subscription: { expiresAt: new Date(Date.now() - 1000) } });
    const e = SubscriptionStatusResponseSchema.parse(await (await get(expired)).json());
    expect(e.lock?.reason).toBe("expired");
    expect(e.period.daysLeft).toBe(0);

    const suspended = await createTenant(h);
    await h.gw.deps.db.update(users).set({ status: "suspended" }).where(eq(users.id, suspended.userId));
    await h.gw.deps.auth.invalidate({ userIds: [suspended.userId] });
    expect((await get(suspended)).status).toBe(401);
  });

  it("G-27: revocation takes effect immediately after /internal/invalidate", async () => {
    const t = await createTenant(h);
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);
    await h.gw.deps.db.update(virtualApiKeys).set({ status: "revoked" }).where(eq(virtualApiKeys.id, t.keyId));
    // Still cached: the 30 s snapshot is the backstop, not the mechanism.
    expect((await call(h, t, "chat", { stream: false })).status).toBe(200);

    const unauthorized = await h.gw.app.request("/internal/invalidate", {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ keyHashes: [t.keyHash] }),
    });
    expect(unauthorized.status).toBe(401);

    const ok = await h.gw.app.request("/internal/invalidate", {
      method: "POST",
      headers: { authorization: `Bearer ${h.config.internalToken}`, "content-type": "application/json" },
      body: JSON.stringify({ keyHashes: [t.keyHash] }),
    });
    expect(await ok.json()).toEqual({ ok: true, invalidated: 1 });
    expect((await errorOf(await call(h, t, "chat", { stream: false }))).code).toBe("key_revoked");
  });

  it("lists only plan models that are servable", async () => {
    const t = await createTenant(h);
    const res = await h.gw.app.request("/v1/models", { headers: { authorization: `Bearer ${t.apiKey}`, "x-forwarded-for": t.ip } });
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((m) => m.id).sort()).toEqual([...t.models].sort());
  });

  it("returns catalog details, and a model the admin hides disappears and is refused", async () => {
    const t = await createTenant(h);
    const [shown, hidden] = t.models;
    await h.gw.deps.db.insert(catalogModels).values([
      { id: shown, displayName: "Shown Model", contextWindow: 200_000, isFree: true, capabilities: { tools: true }, badge: "new", sortOrder: 1 },
      { id: hidden, displayName: "Hidden Model", status: "hidden" },
    ]);
    await h.gw.deps.catalog.reload(new Date());

    const res = await h.gw.app.request("/v1/models", { headers: { authorization: `Bearer ${t.apiKey}`, "x-forwarded-for": t.ip } });
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data.map((m) => m.id)).toEqual([shown]);
    expect(body.data[0]).toMatchObject({
      name: "Shown Model",
      context_window: 200_000,
      free: true,
      capabilities: { tools: true },
      api_type: "openai-chat-completions",
      badge: "new",
    });

    const refused = await errorOf(await call(h, t, "chat", { model: hidden }));
    expect(refused).toMatchObject({ status: 403, code: "model_not_allowed" });
    expect((await call(h, t, "chat", { model: shown, stream: false })).status).toBe(200);
  });
});

describe("upstream secrets never leak (docs/plan/04 §3.1)", () => {
  function assertNoSecret(haystack: string, secrets: string[]) {
    for (const s of secrets) {
      for (let i = 0; i + 8 <= s.length; i += 4) {
        expect(haystack.includes(s.slice(i, i + 8)), `leaked fragment of a pool key`).toBe(false);
      }
    }
  }

  it("error bodies that echo the key are sanitised before reaching the client and the logs", async () => {
    const t = await createTenant(h, { keys: [{ weight: 100 }, { weight: 1 }] });
    const [a, b] = t.poolSecrets as [string, string];
    // 400: a client-type error whose message embeds the key -> returned, but redacted.
    h.mock.script(a, {
      status: 400,
      body: JSON.stringify({ error: { message: `context too long for key ${a}; Authorization: Bearer ${a}` } }),
    });
    h.mock.script(b, { status: 400, body: JSON.stringify({ error: { message: `bad request ${b}` } }) });
    const res = await call(h, t, "chat", { stream: false });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).toContain("context too long");
    assertNoSecret(text, t.poolSecrets);
    assertNoSecret(JSON.stringify(Object.fromEntries(res.headers)), t.poolSecrets);

    // 500 with the key in an HTML body and a Location header -> nothing forwarded.
    const t2 = await createTenant(h);
    const s = t2.poolSecrets[0]!;
    for (let i = 0; i < 3; i += 1) {
      h.mock.script(s, { status: 500, headers: { location: `https://x/?k=${s}` }, body: `<html>${s}</html>` });
    }
    const res2 = await call(h, t2, "chat", { stream: false });
    const text2 = await res2.text();
    expect(res2.status).toBe(503);
    assertNoSecret(text2 + JSON.stringify(Object.fromEntries(res2.headers)), t2.poolSecrets);
  });

  it("no log line contains a pool key or a full virtual key", async () => {
    const all = h.logs.join("\n");
    const secrets = h.mock.requests.map((r) => r.secret).filter((s) => s.startsWith("mock-upstream-key-"));
    expect(secrets.length).toBeGreaterThan(10);
    assertNoSecret(all, [...new Set(secrets)]);
    expect(all).not.toMatch(/sk-dc-[A-Za-z0-9]{43}/);
  });

  it("a pool key object never serialises its secret", async () => {
    const t = await createTenant(h);
    const sel = await h.gw.deps.pool.select(t.providerId, t.models[0], "probe2", new Set());
    if (!sel.key) throw new Error("no key");
    await sel.release();
    const { inspect } = await import("node:util");
    for (const s of [JSON.stringify(sel.key), String(sel.key), inspect(sel.key), `${sel.key}`]) {
      expect(s).not.toContain(t.poolSecrets[0]);
    }
  });
});

describe("skills/MCP sync manifest (docs/plan/04 Phase 2b)", () => {
  it("serves tier-filtered manifests and honours If-None-Match", async () => {
    const t = await createTenant(h, { plan: { tier: "starter" } });
    const db = h.gw.deps.db;
    const { marketplaceSkills, marketplaceMcpPresets, syncState } = await import("@deepcode/db");
    await db.insert(syncState).values({ id: "sync", revision: 7 }).onConflictDoUpdate({ target: syncState.id, set: { revision: 7 } });
    await db.insert(marketplaceSkills).values([
      { slug: "free-skill", nameEn: "Free Skill", nameAr: "مهارة مجانية", descriptionEn: "d", descriptionAr: "w", version: "1.0.0", minTier: "free", archivePath: "skills/x.tar", sha256: "a".repeat(64), itemSignature: "sig-free", status: "published" },
      { slug: "pro-skill", nameEn: "Pro Skill", nameAr: "مهارة احترافية", descriptionEn: "d", descriptionAr: "w", version: "1.0.0", minTier: "pro", archivePath: "skills/y.tar", sha256: "b".repeat(64), itemSignature: "sig-pro", status: "published" },
      { slug: "draft-skill", nameEn: "Draft", nameAr: "مسودة", descriptionEn: "d", descriptionAr: "w", version: "1.0.0", minTier: "free", archivePath: "skills/z.tar", sha256: "c".repeat(64), itemSignature: "sig-draft", status: "draft" },
    ]);
    await db.insert(marketplaceMcpPresets).values({
      slug: "docs-preset", nameEn: "Docs", nameAr: "وثائق", descriptionEn: "d", descriptionAr: "w", version: "1.0.0", minTier: "starter",
      transport: "stdio", command: "deepcode-docs", envSpec: [{ name: "DOCS_DIR", description: "dir" }], itemSignature: "sig-preset", status: "published",
    });

    const get = () => h.gw.app.request("/v1/sync/manifest", { headers: { authorization: `Bearer ${t.apiKey}` } });
    const res = await get();
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as { revision: number; skills: Array<{ id: string; url: string; signature: string }>; mcpPresets: Array<{ id: string; config: { transport: string } }> };
    expect(manifest.revision).toBe(7);
    // Tier filter: starter sees the free skill + starter preset, not the pro one.
    expect(manifest.skills.map((s) => s.id)).toEqual(["free-skill"]);
    expect(manifest.skills[0]!.url).toContain(`/api/v1/skills/`);
    expect(manifest.mcpPresets.map((p) => p.id)).toEqual(["docs-preset"]);
    expect(manifest.mcpPresets[0]!.config.transport).toBe("stdio");

    const etag = res.headers.get("etag")!;
    const notModified = await h.gw.app.request("/v1/sync/manifest", { headers: { authorization: `Bearer ${t.apiKey}`, "if-none-match": etag } });
    expect(notModified.status).toBe(304);
  });

  it("requires the device key", async () => {
    const res = await h.gw.app.request("/v1/sync/manifest");
    expect(res.status).toBe(401);
  });
});

describe("metrics (docs/plan/04 Step A)", () => {
  it("requires the internal token and reports depths, pool state and request counts", async () => {
    const denied = await h.gw.app.request("/metrics");
    expect(denied.status).toBe(401);
    const wrong = await h.gw.app.request("/metrics", { headers: { authorization: `Bearer wrong-token` } });
    expect(wrong.status).toBe(401);

    const t = await createTenant(h);
    h.mock.script(t.poolSecrets[0]!, { status: 429, headers: { "retry-after": "5" } });
    await call(h, t, "chat", { stream: false });
    await call(h, t, "chat", { stream: false }); // served by key B; A cooled for this model
    await sleep(100); // per-key success bookkeeping is fire-and-forget

    const text = await h.gw.metricsText();
    if (process.env.DEBUG_METRICS) console.log("METRICS OUTPUT:\n" + text);
    expect(text).toContain("deepcode_settlement_pending_depth");
    expect(text).toContain("deepcode_settlement_dead_letter_depth");
    expect(text).toMatch(/deepcode_pool_keys\{[^}]*status="active"[^}]*\} [1-9]/);
    expect(text).toMatch(/deepcode_pool_keys\{[^}]*status="cooling"[^}]*\} [1-9]/);
    expect(text).toMatch(/deepcode_requests_total\{[^}]*route="chat_completions"[^}]*class="2xx"[^}]*\} \d+/);
    expect(text).toMatch(/deepcode_pool_key_requests_total\{[^}]*outcome="429"[^}]*\} \d+/);
    expect(text).toContain("deepcode_streams_active");
  });
});

describe("misc", () => {
  it("rejects non-JSON bodies; a body that cannot be shrunk asks the agent to compact (not a dead-end 413)", async () => {
    const t = await createTenant(h);
    const big = await call(h, t, "chat", { body: { pad: "x".repeat(2 * 1024 * 1024) } });
    expect(big.status).toBe(400);
    const err = await errorOf(big);
    expect(err.code).toBe("context_length_exceeded");
    // Agents look for "context … exceeded" (compact) and "image … too large" (strip media).
    expect(err.body.error.message).toMatch(/context limit exceeded/i);
    expect(err.body.error.message).toMatch(/images?.*too large/i);
    const huge = await call(h, t, "chat", { body: { pad: "x".repeat(4 * 1024 * 1024) } });
    expect((await errorOf(huge)).code).toBe("context_length_exceeded");
    const bad = await h.gw.app.request("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${t.apiKey}`, "x-forwarded-for": t.ip, "content-type": "application/json" },
      body: "{not json",
    });
    expect((await errorOf(bad)).code).toBe("bad_request");
  });

  // Customer report 2026-11-18: "Request body too large" (413) killed long sessions full of screenshots.
  it("an oversized session is shrunk: older images become a note, the newest stay, the turn succeeds", async () => {
    const t = await createTenant(h);
    const img = (n: number) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${String(n).repeat(400 * 1024)}` } });
    const messages = [0, 1, 2, 3, 4].map((n) => ({ role: "user", content: [{ type: "text", text: `shot ${n}` }, img(n)] }));
    const res = await call(h, t, "chat", { stream: false, body: { messages } });
    expect(res.status).toBe(200);
    const sent = h.mock.requests.at(-1)!.body as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    const kinds = sent.messages.map((m) => m.content[1]!.type);
    expect(kinds).toEqual(["text", "text", "text", "image_url", "image_url"]);
    expect(sent.messages[0]!.content[1]!.text).toMatch(/earlier image was removed/);
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(1024 * 1024);
  });

  // Synthetic's real wording (measured 2026-11-18); agents did not recognise it before.
  const OVERFLOW = "Error from inference backend: 400 The input (700021 tokens) is longer than the model's context length (524288 tokens).";

  it("Synthetic's context-length error becomes context_length_exceeded so the agent compacts (not retried)", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { status: 400, body: JSON.stringify({ error: OVERFLOW }) });
    const err = await errorOf(await call(h, t, "chat", { stream: false }));
    expect(err.code).toBe("context_length_exceeded");
    expect(err.body.error.message).toMatch(/^Context limit exceeded: .*700021 tokens.*524288 tokens/);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("the same overflow inside a 200 body is not retried as a backend hiccup", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { json: { error: OVERFLOW } });
    const err = await errorOf(await call(h, t, "chat", { stream: false }));
    expect(err.code).toBe("context_length_exceeded");
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("a backend 4xx inside a 200 body is reported, not retried", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { json: { error: "Error from inference backend: 400 tools[0].function.parameters is invalid" } });
    const err = await errorOf(await call(h, t, "chat", { stream: false }));
    expect(err.code).toBe("bad_request");
    expect(err.body.error.message).toMatch(/parameters is invalid/);
    expect(h.mock.requestsFor(t.poolSecrets[0]!)).toHaveLength(1);
  });

  it("an upstream 413 asks the agent to compact instead of failing the session", async () => {
    const t = await createTenant(h, { keys: [{}] });
    h.mock.script(t.poolSecrets[0]!, { status: 413, body: JSON.stringify({ error: { message: "payload too large" } }) });
    const err = await errorOf(await call(h, t, "chat", { stream: false }));
    expect(err.code).toBe("context_length_exceeded");
  });

  it("google streaming without alt=sse is refused", async () => {
    const t = await createTenant(h);
    const res = await h.gw.app.request(`/v1beta/models/${t.models[0]}:streamGenerateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": t.apiKey, "x-forwarded-for": t.ip, "content-type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });
    expect((await errorOf(res)).code).toBe("bad_request");
  });

  it("readiness reports dependencies", async () => {
    const res = await h.gw.app.request("/readyz");
    expect(res.status).toBe(200);
  });

  it("keeps per-user daily rollups consistent with usage logs", async () => {
    const t = await createTenant(h);
    for (let i = 0; i < 3; i += 1) await (await call(h, t, "chat", { stream: false })).text();
    const [daily] = await h.gw.deps.db.select().from(usageDaily).where(and(eq(usageDaily.userId, t.userId), eq(usageDaily.model, t.models[0])));
    expect(daily).toMatchObject({ requests: 3, creditsCharged: 3 * EXPECTED_CREDITS, inputTokens: 360, outputTokens: 90 });
  });
});
