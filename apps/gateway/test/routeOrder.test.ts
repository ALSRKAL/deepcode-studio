import { describe, expect, it } from "vitest";
import { orderRoutes } from "../src/routeOrder.js";

const route = (id: string, isFallback = false) => ({ id, provider: { id, isFallback } });
const ids = (routes: Array<{ id: string }>) => routes.map((r) => r.id);
const quota = (map: Record<string, number | null>) => (id: string) => map[id] ?? null;

describe("orderRoutes", () => {
  const syn = route("synthetic");
  const go = route("opencode-go");

  it("keeps the admin order when nothing is known", () => {
    expect(ids(orderRoutes([syn, go], quota({}), null))).toEqual(["synthetic", "opencode-go"]);
  });

  it("starts a new user on the provider with the most headroom", () => {
    expect(ids(orderRoutes([syn, go], quota({ synthetic: 34, "opencode-go": 80 }), null))).toEqual([
      "opencode-go",
      "synthetic",
    ]);
  });

  it("keeps a user on their provider while it is healthy (prompt cache), even with less headroom", () => {
    expect(ids(orderRoutes([syn, go], quota({ synthetic: 34, "opencode-go": 80 }), "synthetic"))).toEqual([
      "synthetic",
      "opencode-go",
    ]);
  });

  it("moves a user off their provider once it drops under 10%", () => {
    expect(ids(orderRoutes([syn, go], quota({ synthetic: 8, "opencode-go": 60 }), "synthetic"))).toEqual([
      "opencode-go",
      "synthetic",
    ]);
  });

  it("uses a nearly exhausted provider only as a last resort", () => {
    const zen = route("zen");
    expect(
      ids(orderRoutes([syn, go, zen], quota({ synthetic: 1, "opencode-go": 5, zen: null }), "synthetic")),
    ).toEqual(["zen", "opencode-go", "synthetic"]);
  });

  it("treats a provider without a quota API as healthy and shares load with it", () => {
    expect(ids(orderRoutes([syn, go], quota({ synthetic: 40, "opencode-go": null }), null))).toEqual([
      "opencode-go",
      "synthetic",
    ]);
  });

  it("keeps fallback providers behind primaries whatever their quota", () => {
    const paid = route("openrouter", true);
    expect(ids(orderRoutes([paid, syn], quota({ synthetic: 3, openrouter: null }), null))).toEqual([
      "synthetic",
      "openrouter",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [syn, go];
    orderRoutes(input, quota({ synthetic: 1, "opencode-go": 90 }), null);
    expect(ids(input)).toEqual(["synthetic", "opencode-go"]);
  });
});
