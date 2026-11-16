export {};
/**
 * pnpm verify:synthetic — five-point live check of the Synthetic.new upstream.
 *
 * Reads SYNTHETIC_API_KEYS (comma-separated) from the environment / .env. Optional:
 *   DEEPCODE_GATEWAY_URL   gateway to test end to end (default http://127.0.0.1:8790)
 *   DEEPCODE_TEST_KEY      a DeepCode virtual key (sk-dc-...) for check 5
 *
 * Keys are never printed (only their last 4 characters).
 */
const API = "https://api.synthetic.new";
const keys = (process.env.SYNTHETIC_API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
const gateway = (process.env.DEEPCODE_GATEWAY_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");
const testKey = process.env.DEEPCODE_TEST_KEY?.trim();

let failed = 0;
const mask = (k: string) => `…${k.slice(-4)}`;
const ok = (name: string, detail = "") => console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
const bad = (name: string, detail = "") => {
  failed += 1;
  console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
};
const hint = (status: number, body: string) =>
  status === 402 ? "no active Synthetic subscription or credits on this key — subscribe at https://synthetic.new/billing" : `HTTP ${status} ${body.slice(0, 160)}`;

async function json(url: string, key: string, body?: unknown): Promise<{ status: number; text: string; data: any }> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "deepcode-verify/1.0" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { status: res.status, text, data };
}

async function streamText(url: string, key: string, body: unknown): Promise<{ status: number; content: string; usage: any; error: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok || !res.body) return { status: res.status, content: "", usage: null, error: await res.text() };
  let content = "";
  let usage: any = null;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        content += j.choices?.[0]?.delta?.content ?? "";
        if (j.usage) usage = j.usage;
      } catch {
        /* keep-alive or partial */
      }
    }
  }
  return { status: res.status, content, usage, error: "" };
}

if (keys.length === 0) {
  console.log("SYNTHETIC_API_KEYS is not set. Put SYNTHETIC_API_KEYS=syn_... in .env and run again.");
  process.exit(1);
}
const key = keys[0]!;

console.log(`\n1) Quotas (GET /v2/quotas) for ${keys.length} key(s)`);
for (const k of keys) {
  const r = await json(`${API}/v2/quotas`, k);
  if (r.status !== 200) {
    bad(`key ${mask(k)}`, hint(r.status, r.text));
    continue;
  }
  const s = r.data?.subscription;
  if (s && typeof s.limit === "number") {
    const remaining = s.limit - (s.requests ?? 0);
    ok(`key ${mask(k)}`, `remaining ${remaining}/${s.limit} (${Math.round((remaining / s.limit) * 100)}%), renews ${s.renewsAt ?? "?"}`);
  } else {
    bad(`key ${mask(k)}`, "valid key, but no active subscription reported (response {}) — subscribe at https://synthetic.new/billing");
  }
}

console.log("\n2) syn:large:text (DeepSeek V4.1 Flash): chat, then streaming with include_usage");
{
  const r = await json(`${API}/openai/v1/chat/completions`, key, {
    model: "syn:large:text",
    messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    max_tokens: 200,
  });
  if (r.status === 200) ok("chat", `→ ${JSON.stringify(r.data?.choices?.[0]?.message?.content ?? "").slice(0, 40)} usage ${JSON.stringify(r.data?.usage ?? null)}`);
  else bad("chat", hint(r.status, r.text));
  const s = await streamText(`${API}/openai/v1/chat/completions`, key, {
    model: "syn:large:text",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "Count from 1 to 5." }],
    max_tokens: 200,
  });
  if (s.status !== 200) bad("stream", hint(s.status, s.error));
  else if (!s.usage) bad("stream", "no usage chunk with include_usage");
  else ok("stream", `${s.content.length} chars, usage ${JSON.stringify(s.usage)}`);
}

console.log("\n3) Tool calling round trip (MCP-style function)");
{
  const tools = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Weather for a city",
        parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    },
  ];
  const messages: any[] = [{ role: "user", content: "What is the weather in Sana'a? Use the tool." }];
  const first = await json(`${API}/openai/v1/chat/completions`, key, { model: "syn:large:text", messages, tools, tool_choice: "auto", max_tokens: 400 });
  const call = first.data?.choices?.[0]?.message?.tool_calls?.[0];
  if (first.status !== 200) bad("tool call", hint(first.status, first.text));
  else if (!call) bad("tool call", "model answered without calling the tool");
  else {
    ok("tool call", `${call.function?.name}(${call.function?.arguments})`);
    messages.push(first.data.choices[0].message, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ city: "Sana'a", tempC: 24 }) });
    const second = await json(`${API}/openai/v1/chat/completions`, key, { model: "syn:large:text", messages, tools, max_tokens: 400 });
    const answer = second.data?.choices?.[0]?.message?.content ?? "";
    if (second.status === 200 && /24/.test(answer)) ok("tool result used", JSON.stringify(answer).slice(0, 60));
    else bad("tool result used", second.status === 200 ? `answer did not use the result: ${answer.slice(0, 80)}` : hint(second.status, second.text));
  }
}

console.log("\n4) infinite:small:vision (background mode, streaming required)");
{
  const s = await streamText(`${API}/openai/v1/chat/completions`, key, {
    model: "infinite:small:vision",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    max_tokens: 100,
  });
  if (s.status === 200) ok("background stream", `→ ${JSON.stringify(s.content).slice(0, 40)}`);
  else bad("background stream", hint(s.status, s.error));
}

console.log(`\n5) DeepCode gateway end to end (${gateway})`);
if (!testKey) {
  bad("gateway", "set DEEPCODE_TEST_KEY=sk-dc-... (a key from the dashboard of an account with a plan) to run this check");
} else {
  const res = await fetch(`${gateway}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${testKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "deepcode-default", messages: [{ role: "user", content: "Reply with exactly: PONG" }], max_tokens: 200 }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  const remaining = res.headers.get("x-credits-remaining");
  if (res.status !== 200) bad("deepcode-default via gateway", `HTTP ${res.status} ${text.slice(0, 160)}`);
  else if (remaining === null) bad("X-Credits-Remaining header", "missing");
  else ok("deepcode-default via gateway", `X-Credits-Remaining ${remaining}, X-Usage-Percentage ${res.headers.get("x-usage-percentage")}, plan ${res.headers.get("x-plan-name")}`);
}

console.log(failed === 0 ? "\nALL SYNTHETIC CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
