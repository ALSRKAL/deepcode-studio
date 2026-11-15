import { env } from "./env";

/**
 * Fire-and-forget calls into the gateway (docs/plan/02 §4): cache invalidation.
 * Worst case the 30-second snapshot TTL is the backstop, so failures are logged
 * and swallowed — they never fail the user-facing operation.
 */
export async function invalidateGateway(input: {
  keyHashes?: string[];
  userIds?: string[];
  reloadPool?: boolean;
  reloadCatalog?: boolean;
}): Promise<void> {
  try {
    const res = await fetch(new URL("/internal/invalidate", env.GATEWAY_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GATEWAY_INTERNAL_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) console.warn(`[gateway] invalidate returned ${res.status}`);
  } catch (err) {
    console.warn(`[gateway] invalidate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
