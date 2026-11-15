/**
 * Synthetic upstream payloads for all four protocols. Shapes follow each provider's
 * public API. Every fixture reports the same usage so tests can share one expectation:
 *   input 120 (of which 20 cached), output 30 (of which 5 reasoning where supported).
 * These are NOT recordings of OpenCode traffic; Phase 1's gate still requires a live
 * request against a real pool key (docs/plan/04 Phase 1).
 */
export const EXPECTED_USAGE = { input: 120, cachedInput: 20, output: 30 };

const sse = (data: unknown, event?: string) =>
  `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

export type Protocol = "chat" | "anthropic" | "responses" | "google";

export function protocolOf(path: string): Protocol {
  if (path.endsWith("/chat/completions")) return "chat";
  if (path.endsWith("/messages")) return "anthropic";
  if (path.endsWith("/responses")) return "responses";
  return "google";
}

export function streamEvents(protocol: Protocol, opts: { includeUsage: boolean }): string[] {
  const u = opts.includeUsage;
  switch (protocol) {
    case "chat":
      return [
        sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hel" } }] }),
        sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "lo ٱلعالم" } }] }),
        sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        ...(u
          ? [
              sse({
                id: "c1",
                object: "chat.completion.chunk",
                choices: [],
                usage: {
                  prompt_tokens: 120,
                  completion_tokens: 30,
                  prompt_tokens_details: { cached_tokens: 20 },
                  completion_tokens_details: { reasoning_tokens: 5 },
                },
              }),
            ]
          : []),
        sse("[DONE]"),
      ];
    case "anthropic":
      return [
        sse(
          {
            type: "message_start",
            message: {
              id: "m1",
              usage: u
                ? { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 0, output_tokens: 1 }
                : {},
            },
          },
          "message_start",
        ),
        sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start"),
        sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello ٱلعالم" } }, "content_block_delta"),
        sse({ type: "content_block_stop", index: 0 }, "content_block_stop"),
        sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, ...(u ? { usage: { output_tokens: 30 } } : {}) }, "message_delta"),
        sse({ type: "message_stop" }, "message_stop"),
      ];
    case "responses":
      return [
        sse({ type: "response.created", response: { id: "r1" } }, "response.created"),
        sse({ type: "response.output_text.delta", delta: "Hello ٱلعالم" }, "response.output_text.delta"),
        sse(
          {
            type: "response.completed",
            response: {
              id: "r1",
              ...(u
                ? {
                    usage: {
                      input_tokens: 120,
                      input_tokens_details: { cached_tokens: 20 },
                      output_tokens: 30,
                      output_tokens_details: { reasoning_tokens: 5 },
                    },
                  }
                : {}),
            },
          },
          "response.completed",
        ),
      ];
    case "google":
      return [
        sse({
          candidates: [{ content: { parts: [{ text: "Hello" }] } }],
          ...(u ? { usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 10 } } : {}),
        }),
        sse({
          candidates: [{ content: { parts: [{ text: " ٱلعالم" }] }, finishReason: "STOP" }],
          ...(u
            ? {
                usageMetadata: {
                  promptTokenCount: 120,
                  cachedContentTokenCount: 20,
                  candidatesTokenCount: 25,
                  thoughtsTokenCount: 5,
                },
              }
            : {}),
        }),
      ];
  }
}

export function jsonBody(protocol: Protocol, opts: { includeUsage: boolean }): unknown {
  const u = opts.includeUsage;
  switch (protocol) {
    case "chat":
      return {
        id: "c1",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        ...(u
          ? { usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } } }
          : {}),
      };
    case "anthropic":
      return {
        id: "m1",
        type: "message",
        content: [{ type: "text", text: "Hello" }],
        ...(u ? { usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 30 } } : {}),
      };
    case "responses":
      return {
        id: "r1",
        output: [],
        ...(u ? { usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30 } } : {}),
      };
    case "google":
      return {
        candidates: [{ content: { parts: [{ text: "Hello" }] } }],
        ...(u ? { usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 30 } } : {}),
      };
  }
}
