/**
 * Client IP for rate limits and audit rows (review 2026-11-15).
 *
 * Next route handlers and server actions do not expose the socket address, so the
 * only source is a forwarding header — which a client can write. Rules:
 *
 * - Without TRUST_PROXY nothing in the request is trusted: return null. Callers
 *   then rely on per-target limits plus a high global ceiling, never on one tiny
 *   shared bucket that any single client could exhaust for everyone.
 * - With TRUST_PROXY, our proxy APPENDS the address it saw to X-Forwarded-For, so
 *   the trustworthy entry is counted from the RIGHT (`hops` trusted proxies). The
 *   left-most entry is whatever the client sent and is never used.
 * - `X-Real-IP` is honoured only behind a trusted proxy (it overwrites, not appends).
 */
export function clientIpFromHeaders(
  headers: Pick<Headers, "get">,
  opts: { trustProxy: boolean; hops: number },
): string | null {
  if (!opts.trustProxy) return null;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const hops = Math.max(1, Math.floor(opts.hops));
  const fromRight = chain[chain.length - hops];
  if (fromRight && isPlausibleIp(fromRight)) return fromRight;
  const real = headers.get("x-real-ip")?.trim();
  return real && isPlausibleIp(real) ? real : null;
}

function isPlausibleIp(value: string): boolean {
  return value.length <= 45 && /^[0-9a-fA-F:.]+$/.test(value);
}

/** Bucket key: the IP when known, otherwise a shared bucket with a higher limit. */
export function limiterKey(ip: string | null): { key: string; shared: boolean } {
  return ip ? { key: `ip:${ip}`, shared: false } : { key: "shared", shared: true };
}
