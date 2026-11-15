import { db } from "@/lib/db";
import { billingProvider } from "@/lib/billing";
import { handleBillingEvent } from "@/lib/billing/apply";
import { rateLimit } from "@/lib/rateLimit";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/** Bounded body read — webhooks are unauthenticated until the signature check (review L9). */
async function readCappedText(request: Request, max: number): Promise<string | null> {
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

/**
 * POST /api/webhooks/{mock|stripe} — billing webhooks (docs/plan/03 §5.1). The
 * signature is verified against the RAW body before anything is parsed; duplicate
 * provider events are acknowledged and ignored by the idempotency table.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (provider !== "mock" && provider !== "stripe") {
    return new Response(null, { status: 404 });
  }
  // Provider webhooks come from many provider IPs and are signature-checked, so
  // the limit is a load ceiling per provider, not a per-client bucket (review).
  const limit = await rateLimit(`webhook:${provider}`, 1200, 60);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: { code: "rate_limited" } }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(limit.resetSec) },
    });
  }
  const raw = await readCappedText(request, MAX_WEBHOOK_BODY_BYTES);
  if (raw === null) {
    return new Response(JSON.stringify({ error: { code: "payload_too_large" } }), {
      status: 413,
      headers: { "content-type": "application/json" },
    });
  }
  const signature =
    request.headers.get("x-signature") ??
    request.headers.get("stripe-signature") ??
    null;
  try {
    const adapted = billingProvider();
    if (adapted.id !== provider) {
      // The configured provider must match the endpoint; no cross-provider routes.
      return new Response(JSON.stringify({ error: { code: "provider_mismatch" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const event = await adapted.verifyAndParseWebhook(raw, signature);
    const { applied } = await handleBillingEvent(db().db, event);
    return new Response(JSON.stringify({ ok: true, applied }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") ? 400 : 422;
    console.warn(`[webhook:${provider}] rejected: ${message}`);
    return new Response(JSON.stringify({ error: { code: status === 400 ? "bad_signature" : "bad_event" } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
}
