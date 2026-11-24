import { describe, expect, it } from "vitest";
import { promptShape } from "../src/tokenEstimate.js";

describe("promptShape", () => {
  it("splits an OpenAI chat request into tools, system and conversation", () => {
    const shape = promptShape({
      model: "m",
      tools: [{ type: "function", function: { name: "Read", description: "x".repeat(300), parameters: {} } }],
      messages: [
        { role: "system", content: "s".repeat(600) },
        { role: "user", content: "u".repeat(90) },
        { role: "tool", tool_call_id: "1", content: "t".repeat(30) },
      ],
    });
    expect(shape.tools).toBe(1);
    expect(shape.messages).toBe(3);
    expect(shape.toolTokens).toBeGreaterThanOrEqual(100);
    expect(shape.systemTokens).toBeGreaterThanOrEqual(200);
    expect(shape.conversationTokens).toBeGreaterThanOrEqual(40);
    expect(shape.conversationTokens).toBeLessThan(shape.systemTokens);
  });

  it("reads Anthropic's top-level system and responses' instructions", () => {
    expect(promptShape({ system: "s".repeat(300), messages: [] }).systemTokens).toBeGreaterThanOrEqual(100);
    expect(promptShape({ instructions: "i".repeat(300), input: [{ role: "user", content: "hi" }] })).toMatchObject({
      messages: 1,
    });
  });

  it("tolerates missing or odd bodies", () => {
    expect(promptShape(null)).toEqual({ tools: 0, toolTokens: 0, systemTokens: 0, conversationTokens: 0, messages: 0 });
  });
});
