import { contextTooLargeMessage } from "./oversize.js";
import type { Context } from "hono";
import { percentUsed, USAGE_HEADERS } from "@deepcode/shared";
import type { SubscriptionSnapshot } from "./auth.js";
import { GatewayHttpError } from "./errors.js";
import type { RateResult } from "./limits.js";
import type { Balance } from "./metering.js";
import type { SecretRegistry } from "./logger.js";

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // Our proxy APPENDS the address it saw; the left-most entries are client-written
    // and would let a guesser pick a fresh throttle bucket per request (review
    // 2026-11-15). One trusted hop: use the right-most entry.
    const chain = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = chain[chain.length - 1];
    if (last) return last;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

export async function readJsonBody(req: Request, maxBytes: number): Promise<{ json: Record<string, any>; bytes: number }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new GatewayHttpError("context_length_exceeded", contextTooLargeMessage(declared));
  }
  if (!req.body) throw new GatewayHttpError("bad_request", "Request body is required.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      // Not a dead end: agents answer context_length_exceeded by compacting and retrying.
      throw new GatewayHttpError("context_length_exceeded", contextTooLargeMessage(total));
    }
    chunks.push(value);
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayHttpError("bad_request", "Request body must be valid JSON.");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new GatewayHttpError("bad_request", "Request body must be a JSON object.");
  }
  return { json: json as Record<string, any>, bytes: total };
}

export function usageHeaders(sub: SubscriptionSnapshot | null, balance?: Balance | null): Record<string, string> {
  if (!sub) return {};
  const limit = balance?.creditsLimit ?? sub.creditsLimit;
  const used = balance?.creditsUsed ?? sub.creditsUsed;
  return {
    [USAGE_HEADERS.creditsRemaining]: String(Math.max(0, limit - used)),
    [USAGE_HEADERS.usagePercentage]: percentUsed(used, limit).toFixed(1),
    [USAGE_HEADERS.subscriptionExpires]: new Date(sub.expiresAt).toISOString(),
    // Plan id, not display name: Arabic text is not valid in a header value.
    [USAGE_HEADERS.planName]: sub.plan.id,
  };
}

export function rateHeaders(r: RateResult | null): Record<string, string> {
  if (!r) return {};
  return {
    [USAGE_HEADERS.rateLimitLimit]: String(r.limit),
    [USAGE_HEADERS.rateLimitRemaining]: String(r.remaining),
    [USAGE_HEADERS.rateLimitReset]: String(Math.ceil(r.resetMs / 1000)),
  };
}

/** Retry-After as seconds or HTTP date -> milliseconds, or null. */
export function parseRetryAfter(value: string | string[] | undefined, now: number): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const seconds = Number(v);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(v);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Upstream 4xx text reaches the client only as this: the `message` field alone,
 * redacted of registered secrets and any long token-like string, truncated.
 * The raw body is never forwarded (doc 02 §7).
 */
export function sanitizeUpstreamMessage(text: string, secrets: SecretRegistry): string {
  let message: unknown;
  try {
    const j = JSON.parse(text);
    message = j?.error?.message ?? j?.message ?? (typeof j?.error === "string" ? j.error : undefined);
  } catch {
    message = undefined;
  }
  if (typeof message !== "string" || message.trim() === "") {
    return "The model provider rejected the request.";
  }
  const clean = secrets
    .redactString(message)
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return `The model provider rejected the request: ${clean}`;
}
