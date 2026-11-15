import { describe, expect, it } from "vitest";
import { ADAPTERS, SseFramer, type ProtocolAdapter } from "../src/protocols/index.js";
import { EXPECTED_USAGE, streamEvents, type Protocol } from "./helpers/fixtures.js";

const CASES: Array<[Protocol, ProtocolAdapter]> = [
  ["chat", ADAPTERS["openai-chat-completions"]],
  ["anthropic", ADAPTERS["anthropic-messages"]],
  ["responses", ADAPTERS["openai-responses"]],
  ["google", ADAPTERS["google-generative-ai"]],
];

function run(adapter: ProtocolAdapter, chunks: Uint8Array[], injectedUsage: boolean) {
  const framer = new SseFramer();
  const state = adapter.createStreamState({ injectedUsage });
  const forwarded: string[] = [];
  let terminal = 0;
  const feed = (events: ReturnType<SseFramer["push"]>) => {
    for (const ev of events) {
      const r = state.onEvent(ev);
      if (r.terminal) terminal += 1;
      if (r.forward) forwarded.push(ev.raw);
    }
  };
  for (const c of chunks) feed(framer.push(c));
  const tail = framer.flush();
  if (tail) feed([tail]);
  return { usage: state.usage(), forwarded: forwarded.join(""), terminal };
}

describe("usage parsers (G-09)", () => {
  for (const [proto, adapter] of CASES) {
    it(`${proto}: identical usage at every chunk boundary, including inside multi-byte UTF-8`, () => {
      const bytes = new TextEncoder().encode(streamEvents(proto, { includeUsage: true }).join(""));
      for (let cut = 0; cut <= bytes.length; cut += 1) {
        const { usage } = run(adapter, [bytes.slice(0, cut), bytes.slice(cut)], false);
        expect(usage, `cut at byte ${cut}`).toMatchObject(EXPECTED_USAGE);
      }
    });

    it(`${proto}: byte-by-byte delivery forwards the exact upstream text`, () => {
      const text = streamEvents(proto, { includeUsage: true }).join("");
      const bytes = new TextEncoder().encode(text);
      const chunks = Array.from(bytes, (b) => new Uint8Array([b]));
      const { usage, forwarded } = run(adapter, chunks, false);
      expect(usage).toMatchObject(EXPECTED_USAGE);
      expect(forwarded).toBe(text);
    });

    it(`${proto}: reports null usage when the upstream sends none`, () => {
      const bytes = new TextEncoder().encode(streamEvents(proto, { includeUsage: false }).join(""));
      expect(run(adapter, [bytes], false).usage).toBeNull();
    });
  }

  it("chat: withholds the usage-only chunk only when the gateway injected the request (G-10)", () => {
    const text = streamEvents("chat", { includeUsage: true }).join("");
    const bytes = new TextEncoder().encode(text);
    const injected = run(ADAPTERS["openai-chat-completions"], [bytes], true);
    expect(injected.forwarded).not.toContain('"choices":[]');
    expect(injected.forwarded).toContain("[DONE]");
    expect(injected.usage).toMatchObject(EXPECTED_USAGE);
    const asked = run(ADAPTERS["openai-chat-completions"], [bytes], false);
    expect(asked.forwarded).toBe(text);
  });

  it("marks exactly one terminal event for protocols that have one", () => {
    for (const [proto, adapter] of CASES) {
      const bytes = new TextEncoder().encode(streamEvents(proto, { includeUsage: true }).join(""));
      expect(run(adapter, [bytes], false).terminal, proto).toBe(proto === "google" ? 0 : 1);
    }
  });

  it("anthropic: message_delta without cache fields keeps cache reads from message_start", () => {
    const ev = (t: string, d: unknown) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
    const text =
      ev("message_start", { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } } }) +
      ev("message_delta", { type: "message_delta", usage: { output_tokens: 7 } });
    const { usage } = run(ADAPTERS["anthropic-messages"], [new TextEncoder().encode(text)], false);
    expect(usage).toEqual({ input: 100, cachedInput: 90, output: 7, reasoning: 0 });
  });
});

describe("request preparation", () => {
  const ctx = (body: Record<string, any>) => ({ body, query: new URLSearchParams(), headers: new Headers() });

  it("chat injects include_usage only when absent and rewrites the model", () => {
    const a = ADAPTERS["openai-chat-completions"];
    const p1 = a.prepareBody(ctx({ model: "x", stream: true }), { upstreamModel: "x-up", stream: true, maxOutputTokens: null });
    expect(p1.injectedUsage).toBe(true);
    expect(p1.body).toMatchObject({ model: "x-up", stream_options: { include_usage: true } });
    const p2 = a.prepareBody(ctx({ model: "x", stream: true, stream_options: { include_usage: true } }), {
      upstreamModel: "x",
      stream: true,
      maxOutputTokens: null,
    });
    expect(p2.injectedUsage).toBe(false);
  });

  it("clamps output limits to the plan cap in every protocol", () => {
    const cap = 100;
    expect(ADAPTERS["openai-chat-completions"].prepareBody(ctx({ max_tokens: 500, max_completion_tokens: 50 }), { upstreamModel: "m", stream: false, maxOutputTokens: cap }).body).toMatchObject({ max_tokens: 100, max_completion_tokens: 50 });
    expect(ADAPTERS["anthropic-messages"].prepareBody(ctx({ max_tokens: 500 }), { upstreamModel: "m", stream: false, maxOutputTokens: cap }).body.max_tokens).toBe(100);
    expect(ADAPTERS["openai-responses"].prepareBody(ctx({ max_output_tokens: 500 }), { upstreamModel: "m", stream: false, maxOutputTokens: cap }).body.max_output_tokens).toBe(100);
    expect(ADAPTERS["google-generative-ai"].prepareBody(ctx({ generationConfig: { maxOutputTokens: 500 } }), { upstreamModel: "m", stream: false, maxOutputTokens: cap }).body.generationConfig.maxOutputTokens).toBe(100);
  });
});
