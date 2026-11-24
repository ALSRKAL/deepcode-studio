import { revokeDeviceByKey } from "@/lib/desktopAuth";
import { db } from "@/lib/db";
import { invalidateGateway } from "@/lib/gateway";

/**
 * DELETE /api/desktop/device — the desktop's sign-out (docs/plan/01 §6): revokes
 * the Bearer device key and its device row, then busts the gateway snapshot cache.
 */
export async function DELETE(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (!key) {
    return new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const revokedHash = await revokeDeviceByKey(db().db, key);
  // The hash is produced by the server; reduce it to a fixed hex value at this
  // boundary before it is forwarded to the gateway invalidation channel.
  const safeRevokedHash = typeof revokedHash === "string" && /^[0-9a-f]{64}$/.test(revokedHash) ? revokedHash : null;
  if (!safeRevokedHash) {
    return new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  await invalidateGateway({ keyHashes: [safeRevokedHash] });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
