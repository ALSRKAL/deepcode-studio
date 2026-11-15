import type { Redis } from "ioredis";
import type { RedisScripts } from "./redisScripts.js";

const WINDOW_MS = 60_000;
/** Upper bound on how long a leaked slot or reservation survives a crashed instance. */
const STALE_MS = 30 * 60_000;

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export type AdmitResult =
  | { ok: true; rate: RateResult; release: () => Promise<void> }
  | { ok: false; rate: RateResult; reason: "rpm" | "concurrency" | "credits" };

export class Limits {
  constructor(private readonly deps: { redis: Redis; scripts: RedisScripts; now: () => number }) {}

  /**
   * RPM + concurrent-stream slot + credit reservation in one atomic round trip
   * (the hot path). `release` frees the slot and the reservation when the request ends.
   */
  async admit(opts: {
    rpmBucket: string;
    rpmLimit: number;
    subscriptionId: string;
    maxStreams: number;
    remainingCredits: number;
    estimate: number;
    requestId: string;
  }): Promise<AdmitResult> {
    const cc = `cc:${opts.subscriptionId}`;
    const rsv = `rsv:${opts.subscriptionId}`;
    const [code, remaining, resetMs] = await this.deps.scripts.run<[number, number, number]>(
      "ADMIT",
      [`rl:${opts.rpmBucket}`, cc, rsv],
      [
        this.deps.now(),
        WINDOW_MS,
        opts.rpmLimit,
        opts.requestId,
        STALE_MS,
        opts.maxStreams,
        opts.remainingCredits,
        Math.max(1, opts.estimate),
      ],
    );
    const rate: RateResult = { allowed: code !== 1, limit: opts.rpmLimit, remaining: Number(remaining), resetMs: Number(resetMs) };
    if (code !== 0) return { ok: false, rate, reason: code === 1 ? "rpm" : code === 2 ? "concurrency" : "credits" };
    let released = false;
    return {
      ok: true,
      rate,
      release: async () => {
        if (released) return;
        released = true;
        await this.deps.redis.multi().zrem(cc, opts.requestId).hdel(rsv, opts.requestId).exec();
      },
    };
  }

  /** Sliding 60-second window (doc 02 §4 step 7). */
  async rpm(bucket: string, limit: number, member: string): Promise<RateResult> {
    const [allowed, remaining, resetMs] = await this.deps.scripts.run<[number, number, number]>(
      "RPM",
      [`rl:${bucket}`],
      [this.deps.now(), WINDOW_MS, limit, member],
    );
    return { allowed: allowed === 1, limit, remaining: Number(remaining), resetMs: Number(resetMs) };
  }

}
