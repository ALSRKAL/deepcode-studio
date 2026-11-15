import type Redis from "ioredis";
import { createRedis } from "./redis";

/**
 * Fixed-window rate limiter backed by Redis (docs/plan/03 §4, §7). Used for the
 * desktop exchange endpoint and other mutation surfaces where an in-process
 * limiter is not enough across instances.
 */
const redis: Redis = createRedis();

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetSec: number;
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const bucket = `web:rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const [[, count]] = (await redis
    .multi()
    .incr(bucket)
    .expire(bucket, windowSec + 1)
    .exec()) as [[null, number], unknown];
  const used = Number(count ?? 1);
  const ttl = await redis.pttl(bucket);
  return {
    allowed: used <= limit,
    remaining: Math.max(0, limit - used),
    resetSec: Math.ceil(Math.max(0, ttl) / 1000) || windowSec,
  };
}
