import type { TokenUsage } from "@deepcode/shared";
import { parseIfContains } from "./sse.js";
import { clampField, num, type ProtocolAdapter } from "./types.js";

function usageOf(u: any): TokenUsage | null {
  if (!u || typeof u !== "object") return null;
  return {
    input: num(u.input_tokens),
    cachedInput: num(u.input_tokens_details?.cached_tokens),
    output: num(u.output_tokens),
    reasoning: num(u.output_tokens_details?.reasoning_tokens),
  };
}

const TERMINAL = new Set(["response.completed", "response.failed", "response.incomplete"]);

/** OpenAI Responses: POST {base}/responses */
export const openaiResponsesAdapter: ProtocolAdapter = {
  apiType: "openai-responses",
  extractModel: (ctx) => (typeof ctx.body.model === "string" ? ctx.body.model : undefined),
  isStream: (ctx) => ctx.body.stream === true,
  upstreamPath: () => "/responses",
  authHeaders: (secret) => ({ authorization: `Bearer ${secret}` }),
  requestedMaxOutput: (ctx) =>
    typeof ctx.body.max_output_tokens === "number" ? ctx.body.max_output_tokens : undefined,
  prepareBody(ctx, { upstreamModel, maxOutputTokens }) {
    const body = { ...ctx.body, model: upstreamModel };
    clampField(body, "max_output_tokens", maxOutputTokens);
    return { body, injectedUsage: false };
  },
  createStreamState() {
    let usage: TokenUsage | null = null;
    let content = 0;
    return {
      onEvent(ev) {
        const json = parseIfContains(ev.data, ['"response.completed"', '"response.failed"', '"response.incomplete"']);
        const type = ev.event ?? json?.type;
        if (type && TERMINAL.has(type)) {
          const parsed = json ?? parseIfContains(ev.data, ['"usage"']);
          usage = usageOf(parsed?.response?.usage) ?? usage;
          return { forward: true, terminal: true };
        }
        if (type === "response.output_text.delta" || ev.data.includes('"delta"')) content += 1;
        return { forward: true, terminal: false };
      },
      usage: () => usage,
      contentEvents: () => content,
    };
  },
  usageFromJson: (json) => usageOf(json?.usage),
  terminalErrorEvent: () =>
    `event: error\ndata: ${JSON.stringify({ type: "error", code: "upstream_unavailable", message: "Upstream stream interrupted." })}\n\n`,
};
