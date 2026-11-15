/** Locale redirects must never leak the internal origin (production bug: http://localhost:3000). */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import middleware from "../src/middleware";

// Behind the container proxy Next sees its own listen address, not the public host.
// The proxy forwards the public Host and scheme.
const PUBLIC = { host: "deepcode.example", "x-forwarded-proto": "https" };
const internal = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { ...PUBLIC, ...headers } });
const at = (path: string) => `https://deepcode.example${path}`;

describe("locale middleware redirects", () => {
  it("prefix-less paths redirect to the public origin, never the internal one", () => {
    for (const [path, expected] of [
      ["/", "/ar"],
      ["/download", "/ar/download"],
      ["/dashboard", "/ar/dashboard"],
      ["/pricing?plan=pro", "/ar/pricing?plan=pro"],
    ] as const) {
      const res = middleware(internal(path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(at(expected));
    }
  });

  it("negotiates English from the cookie and persists the choice", () => {
    const res = middleware(internal("/docs", { cookie: "NEXT_LOCALE=en" }));
    expect(res.headers.get("location")).toBe(at("/en/docs"));
    expect(res.cookies.get("NEXT_LOCALE")?.value).toBe("en");
  });

  it("locale switch keeps the page and drops the query flag, relatively", () => {
    const res = middleware(internal("/ar/pricing?locale=en"));
    expect(res.headers.get("location")).toBe(at("/en/pricing"));
    expect(res.cookies.get("NEXT_LOCALE")?.value).toBe("en");
  });

  it("a forged Host cannot inject a URL; X-Forwarded-Host wins when present", () => {
    const forged = middleware(internal("/download", { host: "evil.example/@x" }));
    expect(forged.headers.get("location")).toBe("https://localhost:3000/ar/download");
    const fwd = middleware(internal("/download", { "x-forwarded-host": "www.deepcode.example" }));
    expect(fwd.headers.get("location")).toBe("https://www.deepcode.example/ar/download");
  });

  it("locale-prefixed pages pass through with security headers", () => {
    const res = middleware(internal("/ar/download"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
