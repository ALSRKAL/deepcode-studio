import { describe, expect, it } from "vitest";
import { estimateInputTokens } from "../src/tokenEstimate.js";

/** The desktop divisor is 3 chars/token; keep the gateway in step. */
const text = (tokens: number) => "a".repeat(tokens * 3);

describe("estimateInputTokens", () => {
  it("counts text at 3 characters per token", () => {
    expect(estimateInputTokens({ messages: [{ role: "user", content: text(1_000) }] })).toBeGreaterThanOrEqual(1_000);
    expect(estimateInputTokens({ messages: [{ role: "user", content: text(1_000) }] })).toBeLessThan(1_100);
  });

  it("counts system prompts, tool schemas and tool results", () => {
    const body = {
      model: "deepcode-default",
      system: text(500),
      tools: [{ type: "function", function: { name: "read", description: text(500), parameters: { type: "object" } } }],
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "1", function: { name: "read", arguments: JSON.stringify({ path: text(500) }) } }] },
        { role: "tool", tool_call_id: "1", content: text(500) },
      ],
    };
    expect(estimateInputTokens(body)).toBeGreaterThanOrEqual(2_000);
  });

  it("counts a base64 image as one image, not as hundreds of thousands of tokens", () => {
    const base64 = "A".repeat(1_500_000); // ~1.1 MB image
    const chat = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: text(100) },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
    };
    const anthropic = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: text(100) },
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
          ],
        },
      ],
    };
    const google = {
      contents: [{ role: "user", parts: [{ text: text(100) }, { inlineData: { mimeType: "image/png", data: base64 } }] }],
    };
    for (const body of [chat, anthropic, google]) {
      const estimate = estimateInputTokens(body);
      expect(estimate).toBeGreaterThanOrEqual(1_600);
      expect(estimate).toBeLessThan(2_000);
    }
  });

  it("ignores raw data URLs outside an image part", () => {
    expect(estimateInputTokens({ messages: [{ role: "user", content: "data:text/plain;base64,AAAA" }] })).toBeLessThan(50);
  });

  it("does not overflow on deeply nested input", () => {
    let nested: Record<string, unknown> = { text: "leaf" };
    for (let i = 0; i < 300; i += 1) nested = { child: nested };
    expect(() => estimateInputTokens(nested)).not.toThrow();
  });
});
