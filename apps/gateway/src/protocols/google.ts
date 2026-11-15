import type { TokenUsage } from "@deepcode/shared";
import { parseIfContains } from "./sse.js";
import { clampField, num, type ProtocolAdapter } from "./types.js";

/** Google reports thinking tokens outside candidatesTokenCount; output = candidates + thoughts. */
function usageOf(u: any): TokenUsage | null {
  if (!u || typeof u !== "object") return null;
  const thoughts = num(u.thoughtsTokenCount);
  return {
    input: num(u.promptTokenCount),
    cachedInput: num(u.cachedContentTokenCount),
    output: num(u.candidatesTokenCount) + thoughts,
    reasoning: thoughts,
  };
}

/**
 * Google Generative AI: POST {base}/models/{model}:generateContent
 *                       POST {base}/models/{model}:streamGenerateContent?alt=sse
 * The model is in the URL, not the body. Streaming requires alt=sse; Google's
 * JSON-array streaming format is not supported.
 */
export const googleAdapter: ProtocolAdapter = {
  apiType: "google-generative-ai",
  extractModel: (ctx) => ctx.pathModel,
  isStream: (ctx) => ctx.pathMethod === "streamGenerateContent",
  upstreamPath: (upstreamModel, _ctx, stream) =>
    `/models/${encodeURIComponent(upstreamModel)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
  authHeaders: (secret) => ({ "x-goog-api-key": secret }),
  requestedMaxOutput: (ctx) => {
    const v = ctx.body.generationConfig?.maxOutputTokens;
    return typeof v === "number" ? v : undefined;
  },
  prepareBody(ctx, { maxOutputTokens }) {
    const body = { ...ctx.body };
    if (body.generationConfig && typeof body.generationConfig === "object") {
      body.generationConfig = { ...body.generationConfig };
      clampField(body.generationConfig, "maxOutputTokens", maxOutputTokens);
    }
    return { body, injectedUsage: false };
  },
  createStreamState() {
    let usage: TokenUsage | null = null;
    let content = 0;
    return {
      onEvent(ev) {
        const json = parseIfContains(ev.data, ['"usageMetadata"']);
        // Later chunks are cumulative; the last one is authoritative.
        const u = usageOf(json?.usageMetadata);
        if (u) usage = u;
        if (ev.data.includes('"candidates"')) content += 1;
        return { forward: true, terminal: false };
      },
      usage: () => usage,
      contentEvents: () => content,
    };
  },
  usageFromJson: (json) => usageOf(json?.usageMetadata),
  terminalErrorEvent: () =>
    `data: ${JSON.stringify({ error: { code: 503, message: "Upstream stream interrupted.", status: "UNAVAILABLE" } })}\n\n`,
};
