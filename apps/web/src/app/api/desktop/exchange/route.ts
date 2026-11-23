import { createHash } from "node:crypto";
import {
  DesktopExchangeRequestSchema,
  DesktopExchangeResponseSchema,
  type DesktopExchangeErrorCode,
} from "@deepcode/shared";
import { db } from "@/lib/db";
import { exchangeDesktopCode } from "@/lib/desktopAuth";
import { invalidateGateway } from "@/lib/gateway";
import { rateLimit } from "@/lib/rateLimit";
import { clientIpFromHeaders, limiterKey } from "@/lib/clientIp";
import { env } from "@/lib/env";

/**
 * POST /api/desktop/exchange — the desktop deep-link callback (docs/plan/03 §4.1
 * step 6, W-03/W-04). Rate limited per IP; every failure path returns a typed code
 * with no information beyond the class, so codes cannot be probed.
 */
const STATUS: Record<DesktopExchangeErrorCode | "success", number> = {
  success: 200,
  invalid_request: 400,
  invalid_code: 401,
  expired_code: 401,
  used_code: 401,
  pkce_mismatch: 401,
  state_mismatch: 401,
  device_limit: 403,
  rate_limited: 429,
  unauthorized: 401,
};

const MAX_EXCHANGE_BODY_BYTES = 16 * 1024;

/** Reads at most `max` bytes; undefined when the body exceeds it (review L9). */
async function readCappedBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export async function POST(request: Request): Promise<Response> {
  // Per IP behind a trusted proxy (10/min); otherwise a shared ceiling that bounds
  // load without letting one client block every desktop sign-in (review). The
  // 256-bit single-use code makes guessing impractical either way.
  const bucket = limiterKey(clientIpFromHeaders(request.headers, { trustProxy: env.TRUST_PROXY, hops: env.TRUSTED_PROXY_HOPS }));
  // Hash the client-derived bucket before it becomes a Redis key; the limiter only
  // needs identity, and a fixed hex key can never carry separators or control bytes.
  const bucketId = createHash("sha256").update(bucket.key).digest("hex").slice(0, 32);
  const limit = await rateLimit(`exchange:${bucketId}`, bucket.shared ? 600 : 10, 60);
  if (!limit.allowed) {
    return jsonResponse({ error: { code: "rate_limited" } }, 429, { "retry-after": String(limit.resetSec) });
  }

  const raw = await readCappedBody(request, MAX_EXCHANGE_BODY_BYTES);
  let body: unknown = null;
  try {
    body = raw === null ? null : JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = DesktopExchangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: { code: "invalid_request" } }, STATUS.invalid_request);
  }

  const result = await exchangeDesktopCode(db().db, {
    code: parsed.data.code,
    codeVerifier: parsed.data.code_verifier,
    device: {
      name: parsed.data.device.name,
      os: parsed.data.device.os,
      appVersion: parsed.data.device.app_version,
    },
  });

  if (!result.ok) {
    return jsonResponse({ error: { code: result.code } }, STATUS[result.code]);
  }

  await invalidateGateway({ userIds: [result.user.id] });
  const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8790";
  const body2 = DesktopExchangeResponseSchema.parse({
    apiKey: result.apiKey,
    user: result.user,
    plan: { id: result.plan.id, tier: result.plan.tier, name: { en: result.plan.nameEn, ar: result.plan.nameAr } },
    gatewayBaseUrl: gatewayUrl.replace(/\/$/, "") + "/v1",
  });
  return jsonResponse(body2, 200);
}

function jsonResponse(payload: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
