import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayErrorSchema } from "@deepcode/shared";
import { call, createTenant, startHarness, type Harness, type Tenant } from "./helpers/harness.js";

const CAP = 2_000;
let h: Harness;
let t: Tenant;

beforeAll(async () => {
  h = await startHarness({ maxRequestInputTokens: CAP });
  t = await createTenant(h);
});
afterAll(async () => {
  await h?.close();
});

describe("MAX_REQUEST_INPUT_TOKENS", () => {
  it("rejects an oversized request with the N tokens > M shape the desktop parses", async () => {
    const res = await call(h, t, "chat", {
      stream: false,
      body: { messages: [{ role: "user", content: "a".repeat(CAP * 3 + 3_000) }] },
    });
    expect(res.status).toBe(400);
    const body = GatewayErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("context_length_exceeded");
    // compact-selection.ts matches /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/
    expect(body.error.message).toMatch(/\d[\d,]* tokens > 2,000/);
  });

  it("admits a request under the cap", async () => {
    const res = await call(h, t, "chat", { stream: false });
    expect(res.status).toBe(200);
  });

  it("exposes the size histogram and the rejection counter", async () => {
    const text = await h.gw.metricsText();
    expect(text).toContain("deepcode_request_input_tokens");
    expect(text).toContain("deepcode_context_rejections_total");
    expect(text).toMatch(/deepcode_context_rejections_total\{[^}]*model="[^"]+"[^}]*\} 1/);
  });
});
