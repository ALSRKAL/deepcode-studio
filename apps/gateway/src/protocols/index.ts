import type { UpstreamApiType } from "@deepcode/shared";
import { anthropicAdapter } from "./anthropic.js";
import { googleAdapter } from "./google.js";
import { openaiChatAdapter } from "./openaiChat.js";
import { openaiResponsesAdapter } from "./openaiResponses.js";
import type { ProtocolAdapter } from "./types.js";

export const ADAPTERS: Record<UpstreamApiType, ProtocolAdapter> = {
  "openai-chat-completions": openaiChatAdapter,
  "anthropic-messages": anthropicAdapter,
  "openai-responses": openaiResponsesAdapter,
  "google-generative-ai": googleAdapter,
};

export * from "./types.js";
export * from "./sse.js";
