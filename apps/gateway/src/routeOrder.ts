/**
 * Order a model's routes across providers by remaining quota, with per-user affinity
 * (2026-11-21).
 *
 * The owner runs more than one subscription (Synthetic now, OpenCode Go later). Before
 * this, routes were tried in a fixed priority order, so the first provider took every
 * request until it failed, even at 5% weekly credit left, and users only moved after an
 * error. Now:
 *
 * - **Headroom:** a provider's headroom is its best key's remaining quota (the lower of
 *   its request window and weekly credit, see synthetic.ts). Unknown (no quota API, e.g.
 *   OpenCode Go) counts as healthy; its limits still surface as 429 cooldowns in the pool.
 * - **Tiers:** healthy (>= LOW_PCT) first, then low, then nearly exhausted (< EXHAUSTED_PCT),
 *   so a provider about to run out is only used when nothing else can serve.
 * - **Affinity:** within the healthy tier the user's last provider goes first. Prompt
 *   caches live per provider; moving a conversation mid-session pays full input price
 *   once and is what makes switching visible in cost. A user moves only when their
 *   provider drops out of the healthy tier or fails (the request loop then tries the
 *   next route, as before).
 * - **Balance:** a user without affinity starts on the healthy provider with the most
 *   headroom; ties keep the admin's priority order.
 *
 * Pure function: the caller supplies headroom and affinity.
 */
export const LOW_PCT = 10;
export const EXHAUSTED_PCT = 2;

export interface OrderableRoute {
  provider: { id: string; isFallback: boolean };
}

type Tier = 0 | 1 | 2;

function tier(headroom: number | null): Tier {
  if (headroom === null || headroom >= LOW_PCT) return 0;
  if (headroom >= EXHAUSTED_PCT) return 1;
  return 2;
}

export function orderRoutes<R extends OrderableRoute>(
  routes: readonly R[],
  headroom: (providerId: string) => number | null,
  affinityProviderId: string | null,
): R[] {
  const decorated = routes.map((route, index) => {
    const h = headroom(route.provider.id);
    return {
      route,
      index,
      // Fallback providers stay behind primaries whatever their quota (paid overflow).
      fallback: route.provider.isFallback ? 1 : 0,
      tier: tier(h),
      sticky: route.provider.id === affinityProviderId && tier(h) === 0 ? 0 : 1,
      // Unknown quota sorts as "plenty" but below a known higher reading is not implied:
      // treat it as 100 so an unmetered provider shares load with a metered one.
      headroom: h ?? 100,
    };
  });
  decorated.sort(
    (a, b) =>
      a.fallback - b.fallback ||
      a.tier - b.tier ||
      a.sticky - b.sticky ||
      b.headroom - a.headroom ||
      a.index - b.index,
  );
  return decorated.map((d) => d.route);
}
