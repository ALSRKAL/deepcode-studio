import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, limiterKey } from "@/lib/clientIp";

/** Rate-limit keying (review 2026-11-15): client-written header parts never choose the bucket. */
describe("clientIpFromHeaders", () => {
  const h = (values: Record<string, string>) => new Headers(values);

  it("trusts nothing without a configured proxy", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }), { trustProxy: false, hops: 1 })).toBeNull();
  });

  it("uses the right-most entry appended by one trusted proxy", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" });
    expect(clientIpFromHeaders(headers, { trustProxy: true, hops: 1 })).toBe("198.51.100.7");
  });

  it("counts several trusted hops from the right", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" });
    expect(clientIpFromHeaders(headers, { trustProxy: true, hops: 2 })).toBe("198.51.100.7");
  });

  it("rejects garbage and falls back to x-real-ip only behind a proxy", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "<script>" }), { trustProxy: true, hops: 1 })).toBeNull();
    expect(clientIpFromHeaders(h({ "x-real-ip": "2001:db8::1" }), { trustProxy: true, hops: 1 })).toBe("2001:db8::1");
  });

  it("maps an unknown IP to the shared bucket", () => {
    expect(limiterKey(null)).toEqual({ key: "shared", shared: true });
    expect(limiterKey("1.2.3.4")).toEqual({ key: "ip:1.2.3.4", shared: false });
  });
});
