import { ClientConfigsResponseSchema, type ClientConfigsResponse } from "@deepcode/shared";
import { authenticateVirtualKey } from "@/lib/virtualKeyAuth";

/**
 * GET /api/v1/client/configs — runtime configuration for the installed app
 * (docs/plan/01 §3): origins, feature switches and notices. Authenticated with
 * the device key so origin overrides cannot be enumerated anonymously.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await authenticateVirtualKey(request);
  if (!ctx || ctx.userStatus !== "active") {
    return new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const webUrl = (process.env.APP_URL ?? "http://localhost:3210").replace(/\/$/, "");
  const gatewayUrl = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");
  const body: ClientConfigsResponse = ClientConfigsResponseSchema.parse({
    gatewayUrl: `${gatewayUrl}/v1`,
    webUrl,
    syncUrl: `${gatewayUrl}/v1/sync/manifest`,
    releasesUrl: `${webUrl}/api/v1/releases/electron/manifest`,
    features: {
      // Owner decision 3 (docs/plan/04 §3): BYOK stays behind an Advanced section.
      byok: true,
      managedSync: true,
    },
    notices: [],
  });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
