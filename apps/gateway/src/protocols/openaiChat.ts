import type { TokenUsage } from "@deepcode/shared";
import { parseIfContains } from "./sse.js";
import { clampField, num, type ProtocolAdapter } from "./types.js";

function usageOf(u: any): TokenUsage | null {
  if (!u || typeof u !== "object") return null;
  return {
    input: num(u.prompt_tokens),
    cachedInput: num(u.prompt_tokens_details?.cached_tokens),
    output: num(u.completion_tokens),
    reasoning: num(u.completion_tokens_details?.reasoning_tokens),
  };
}

/** OpenAI Chat Completions: POST {base}/chat/completions */
export const openaiChatAdapter: ProtocolAdapter = {
  apiType: "openai-chat-completions",
  extractModel: (ctx) => (typeof ctx.body.model === "string" ? ctx.body.model : undefined),
  isStream: (ctx) => ctx.body.stream === true,
  upstreamPath: () => "/chat/completions",
  authHeaders: (secret) => ({ authorization: `Bearer ${secret}` }),
  requestedMaxOutput: (ctx) => {
    const v = ctx.body.max_completion_tokens ?? ctx.body.max_tokens;
    return typeof v === "number" ? v : undefined;
  },
  prepareBody(ctx, { upstreamModel, stream, maxOutputTokens }) {
    const body: Record<string, any> = { ...ctx.body, model: upstreamModel };
    clampField(body, "max_tokens", maxOutputTokens);
    clampField(body, "max_completion_tokens", maxOutputTokens);
    let injectedUsage = false;
    if (stream && body.stream_options?.include_usage !== true) {
      body.stream_options = { ...body.stream_options, include_usage: true };
      injectedUsage = true;
    }
    return { body, injectedUsage };
  },
  createStreamState({ injectedUsage }) {
    let usage: TokenUsage | null = null;
    let content = 0;
    return {
      onEvent(ev) {
        if (ev.data === "[DONE]") return { forward: true, terminal: true };
        const json = parseIfContains(ev.data, ['"usage"']);
        const u = usageOf(json?.usage);
        if (u) usage = u;
        // The usage-only chunk (choices: []) exists only because we asked for it.
        if (u && injectedUsage && Array.isArray(json.choices) && json.choices.length === 0) {
          return { forward: false, terminal: false };
        }
        if (ev.data.length > 0) content += 1;
        return { forward: true, terminal: false };
      },
      usage: () => usage,
      contentEvents: () => content,
    };
  },
  usageFromJson: (json) => usageOf(json?.usage),
  terminalErrorEvent: () =>
    `data: ${JSON.stringify({ error: { message: "Upstream stream interrupted.", type: "upstream_error", code: "upstream_unavailable" } })}\n\n`,
};
