import { cookies } from "next/headers";

/**
 * Copy the Set-Cookie headers of a better-auth API call (`returnHeaders: true`)
 * into the Next.js cookie store of the current server action.
 *
 * Needed where better-auth REPLACES the session inside the call (enabling 2FA
 * creates a new session and deletes the old one; the 2FA sign-in step creates
 * the first one): if the new cookie does not reach the browser, the user is
 * signed out on the next request. Applying the headers explicitly makes that
 * independent of the plugin-hook ordering.
 */
export async function applyAuthSetCookies(responseHeaders: Headers | undefined | null): Promise<void> {
  if (!responseHeaders) return;
  const list =
    typeof responseHeaders.getSetCookie === "function"
      ? responseHeaders.getSetCookie()
      : (responseHeaders.get("set-cookie") ?? "").split(/,(?=\s*[^;=\s]+=)/);
  if (list.length === 0) return;
  const store = await cookies();
  for (const raw of list) {
    const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = decodeURIComponentSafe(pair.slice(eq + 1));
    const options: Parameters<typeof store.set>[2] = {};
    for (const attr of attrs) {
      const [k, ...rest] = attr.split("=");
      const key = k!.toLowerCase();
      const v = rest.join("=");
      if (key === "path") options.path = v;
      else if (key === "domain") options.domain = v;
      else if (key === "max-age") options.maxAge = Number(v);
      else if (key === "expires") options.expires = new Date(v);
      else if (key === "httponly") options.httpOnly = true;
      else if (key === "secure") options.secure = true;
      else if (key === "samesite") options.sameSite = v.toLowerCase() as "lax" | "strict" | "none";
    }
    store.set(name, value, options);
  }
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
