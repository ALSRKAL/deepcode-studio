import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeCredits } from "@deepcode/shared";
import { SYNTHETIC_MODELS, syntheticCredits, usageLogs } from "@deepcode/db";
import { aggregateChatCompletionStream, parseSyntheticQuota, quotaAlert } from "../src/synthetic.js";
import { call, createTenant, EXPECTED_CREDITS, startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

async function chargedCredits(requestId: string | null): Promise<number> {
  for (let i = 0; i < 40; i += 1) {
    const [row] = await h.gw.deps.db.select().from(usageLogs).where(eq(usageLogs.requestId, requestId!));
    if (row) return Number(row.creditsCharged);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("usage row not written");
}

describe("Synthetic: background (infinite) models", () => {
  it("forces stream upstream and returns assembled JSON to a non-streaming caller", async () => {
    const t = await createTenant(h, { upstreamModel: () => "infinite:small:vision" });
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello ٱلعالم");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage).toBeTruthy();
    const sent = h.mock.requestsFor(t.poolSecrets[0]!)[0]!;
    expect(sent.body.stream).toBe(true);
    expect(sent.body.model).toBe("infinite:small:vision");
    expect(sent.body.stream_options).toEqual({ include_usage: true });
  });

  it("passes streaming callers through unchanged", async () => {
    const t = await createTenant(h, { upstreamModel: () => "infinite:small:vision" });
    const res = await call(h, t, "chat", { stream: true });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toContain("[DONE]");
    expect(h.mock.requestsFor(t.poolSecrets[0]!)[0]!.body.stream).toBe(true);
  });

  it("refuses non-streaming background requests on endpoints that cannot be assembled", async () => {
    const t = await createTenant(h, { upstreamModel: () => "infinite:small:vision" });
    const res = await call(h, t, "anthropic", { stream: false });
    expect(res.status).toBe(400);
  });
});

describe("Synthetic: fast mode", () => {
  it("is refused on plans without fast mode", async () => {
    const t = await createTenant(h);
    const res = await call(h, t, "chat", { stream: false, model: `fast:${t.models[0]}` });
    expect(res.status).toBe(403);
  });

  it("prefixes the upstream model and charges twice the credits on Team", async () => {
    const t = await createTenant(h, { plan: { tier: "team" } });
    const normal = await call(h, t, "chat", { stream: false });
    expect(normal.status).toBe(200);
    const fast = await call(h, t, "chat", { stream: false, model: `fast:${t.models[0]}` });
    expect(fast.status).toBe(200);
    const sent = h.mock.requestsFor(t.poolSecrets[0]!);
    expect(sent[0]!.body.model).toBe(`${t.models[0]}-upstream`);
    expect(sent[1]!.body.model).toBe(`fast:${t.models[0]}-upstream`);
    const a = await chargedCredits(normal.headers.get("x-request-id"));
    const b = await chargedCredits(fast.headers.get("x-request-id"));
    expect(a).toBe(EXPECTED_CREDITS);
    expect(b).toBe(2 * a);
  });

  it("cannot be combined with a background model", async () => {
    const t = await createTenant(h, { plan: { tier: "team" }, upstreamModel: () => "infinite:small:vision" });
    const res = await call(h, t, "chat", { stream: true, model: `fast:${t.models[0]}` });
    expect(res.status).toBe(400);
  });
});

describe("Synthetic: key pool", () => {
  it("a 402 (no subscription or credits on that key) cools it and another key serves", async () => {
    const t = await createTenant(h, { keys: [{ weight: 100 }, { weight: 1 }] });
    const [a, b] = t.poolSecrets as [string, string];
    h.mock.script(a, { status: 402, body: JSON.stringify({ error: "Insufficient credits and no active subscription." }) });
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(200);
    expect(h.mock.requestsFor(a)).toHaveLength(1);
    expect(h.mock.requestsFor(b)).toHaveLength(1);
  });
});

describe("Synthetic: pass-through for MCP tools and reasoning", () => {
  it("streams tool_calls and reasoning_content chunks unchanged", async () => {
    const t = await createTenant(h);
    const chunks = [
      sse({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "Let me think" } }] }),
      sse({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":" } }] } }] }),
      sse({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"a.ts\"}" } }] }, finish_reason: "tool_calls" }] }),
      sse({ id: "c", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      "data: [DONE]\n\n",
    ];
    h.mock.script(t.poolSecrets[0]!, { events: chunks });
    const tools = [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
    const res = await call(h, t, "chat", { stream: true, body: { tools, tool_choice: "auto", parallel_tool_calls: true } });
    const text = await res.text();
    expect(text).toContain('"reasoning_content":"Let me think"');
    expect(text).toContain('"name":"read_file"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    const sent = h.mock.requestsFor(t.poolSecrets[0]!)[0]!.body;
    expect(sent.tools).toEqual(tools);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.parallel_tool_calls).toBe(true);
  });

  it("keeps the prompt prefix byte-identical across turns (prompt caching)", async () => {
    const t = await createTenant(h);
    const messages = [
      { role: "system", content: "You are DeepCode. Tools follow." },
      { role: "user", content: "hello" },
    ];
    await (await call(h, t, "chat", { stream: false, body: { messages } })).text();
    await (await call(h, t, "chat", { stream: false, body: { messages } })).text();
    const [first, second] = h.mock.requestsFor(t.poolSecrets[0]!);
    expect(JSON.stringify(first!.body)).toBe(JSON.stringify(second!.body));
    expect(first!.body.messages).toEqual(messages);
    for (const name of ["x-request-id", "date", "x-timestamp"]) {
      expect(first!.headers[name]).toBeUndefined();
    }
  });
});

describe("Synthetic: web search", () => {
  it("proxies POST /v1/tools/web-search to the upstream /v2/search with a pool key", async () => {
    const t = await createTenant(h, { providerPrefix: "synthetic" });
    const results = { results: [{ url: "https://example.test", title: "Example", text: "..." }] };
    h.mock.script(t.poolSecrets[0]!, { json: results });
    const res = await h.gw.app.request("/v1/tools/web-search", {
      method: "POST",
      headers: { authorization: `Bearer ${t.apiKey}`, "content-type": "application/json", "x-forwarded-for": t.ip },
      body: JSON.stringify({ query: "python requests docs" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(results);
    const sent = h.mock.requestsFor(t.poolSecrets[0]!)[0]!;
    expect(sent.path).toBe("/v2/search");
    expect(sent.body).toEqual({ query: "python requests docs" });
  });

  it("rejects an empty query", async () => {
    const t = await createTenant(h, { providerPrefix: "synthetic" });
    const res = await h.gw.app.request("/v1/tools/web-search", {
      method: "POST",
      headers: { authorization: `Bearer ${t.apiKey}`, "content-type": "application/json", "x-forwarded-for": t.ip },
      body: JSON.stringify({ query: " " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Synthetic: units", () => {
  it("parses /v2/quotas, including an account without a subscription", () => {
    const q = parseSyntheticQuota({ subscription: { limit: 200, requests: 170, renewsAt: "2026-11-20T00:00:00.000Z" } });
    expect(q).toMatchObject({ remainingPct: 15, limit: 200, used: 170 });
    expect(q.renewsAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(quotaAlert(q, Date.parse("2026-11-01T00:00:00Z"))).toBe("low");
    expect(parseSyntheticQuota({})).toEqual({ remainingPct: null, renewsAt: null, limit: null, used: null });
    const renewing = parseSyntheticQuota({ subscription: { limit: 100, requests: 10, renewsAt: "2026-11-02T00:00:00Z" } });
    expect(quotaAlert(renewing, Date.parse("2026-11-01T00:00:00Z"))).toBe("renewing");
  });

  it("assembles a stream with tool calls and reasoning into one chat.completion", () => {
    const body = aggregateChatCompletionStream(
      [
        sse({ id: "x", model: "m", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "think " } }] }),
        sse({ id: "x", choices: [{ index: 0, delta: { reasoning_content: "more" } }] }),
        sse({ id: "x", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "ls", arguments: "{" } }] } }] }),
        sse({ id: "x", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] }, finish_reason: "tool_calls" }] }),
        sse({ id: "x", choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
        "data: [DONE]\n\n",
      ].join(""),
    ) as any;
    expect(body.choices[0].message).toEqual({
      role: "assistant",
      content: null,
      reasoning_content: "think more",
      tool_calls: [{ id: "c1", type: "function", function: { name: "ls", arguments: "{}" } }],
    });
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4 });
  });

  it("charges cached input at 25% of the input price (75% discount)", () => {
    const model = SYNTHETIC_MODELS.find((m) => m.id === "deepcode-default")!;
    const [input, output, cached] = syntheticCredits(model);
    expect(cached).toBe(Math.round(input * 0.25));
    const price = { inputPerMTok: input, outputPerMTok: output, cachedInputPerMTok: cached };
    const fresh = computeCredits({ input: 1_000_000, cachedInput: 0, output: 0, reasoning: 0 }, price);
    const allCached = computeCredits({ input: 1_000_000, cachedInput: 1_000_000, output: 0, reasoning: 0 }, price);
    expect(allCached).toBe(Math.round(fresh * 0.25));
  });

  it("background models are free and every model has a price", () => {
    for (const m of SYNTHETIC_MODELS) {
      const [input, output] = syntheticCredits(m);
      if (m.upstreamModel.startsWith("infinite:")) expect(input + output).toBe(0);
      else expect(input).toBeGreaterThan(0);
    }
  });
});

describe("Synthetic: SYNTHETIC_API_KEYS seeding", () => {
  it("adds new env keys once, encrypted, and never duplicates them", async () => {
    const { seedSyntheticKeysFromEnv } = await import("../src/synthetic.js");
    const { upstreamPoolKeys: keysTable } = await import("@deepcode/db");
    const unique = `syn_test_${Date.now()}`;
    const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    const db = h.gw.deps.db;
    const first = await seedSyntheticKeysFromEnv({ db, encryptionKey: h.config.encryptionKey, raw: `${unique}_a, ${unique}_b`, log });
    const again = await seedSyntheticKeysFromEnv({ db, encryptionKey: h.config.encryptionKey, raw: `${unique}_a,${unique}_b`, log });
    expect(first).toBe(2);
    expect(again).toBe(0);
    const rows = await db.select().from(keysTable).where(eq(keysTable.providerId, "synthetic"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(Buffer.from(r.keyCiphertext).toString("utf8")).not.toContain(unique);
  });
});
