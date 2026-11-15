import type { TokenUsage } from "@deepcode/shared";
import { parseIfContains } from "./sse.js";
import { clampField, num, type ProtocolAdapter } from "./types.js";

/**
 * Anthropic reports uncached input, cache reads and cache writes separately.
 * Normalised: input = all three (cache writes billed as input), cachedInput = reads.
 */
function usageOf(u: any): TokenUsage | null {
  if (!u || typeof u !== "object") return null;
  const reads = num(u.cache_read_input_tokens);
  return {
    input: num(u.input_tokens) + reads + num(u.cache_creation_input_tokens),
    cachedInput: reads,
    output: num(u.output_tokens),
    reasoning: 0,
  };
}

/** Anthropic Messages: POST {base}/messages */
export const anthropicAdapter: ProtocolAdapter = {
  apiType: "anthropic-messages",
  extractModel: (ctx) => (typeof ctx.body.model === "string" ? ctx.body.model : undefined),
  isStream: (ctx) => ctx.body.stream === true,
  upstreamPath: () => "/messages",
  authHeaders: (secret) => ({ "x-api-key": secret }),
  requestedMaxOutput: (ctx) => (typeof ctx.body.max_tokens === "number" ? ctx.body.max_tokens : undefined),
  prepareBody(ctx, { upstreamModel, maxOutputTokens }) {
    const body = { ...ctx.body, model: upstreamModel };
    clampField(body, "max_tokens", maxOutputTokens);
    return { body, injectedUsage: false };
  },
  createStreamState() {
    // Raw fields tracked separately: message_delta repeats only some of them
    // (output_tokens is cumulative), and must not reset the others.
    const raw: Record<string, number> = {};
    let seen = false;
    let content = 0;
    const absorb = (u: any) => {
      if (!u || typeof u !== "object") return;
      for (const f of ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"]) {
        if (typeof u[f] === "number") {
          raw[f] = u[f];
          seen = true;
        }
      }
    };
    return {
      onEvent(ev) {
        const json = parseIfContains(ev.data, ['"usage"', '"message_stop"']);
        const type = ev.event ?? json?.type;
        if (type === "message_stop") return { forward: true, terminal: true };
        if (type === "message_start") absorb(json?.message?.usage);
        else if (type === "message_delta") absorb(json?.usage);
        else if (type === "content_block_delta") content += 1;
        return { forward: true, terminal: false };
      },
      usage: () => (seen ? usageOf(raw) : null),
      contentEvents: () => content,
    };
  },
  usageFromJson: (json) => usageOf(json?.usage),
  terminalErrorEvent: () =>
    `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: "Upstream stream interrupted." } })}\n\n`,
};
