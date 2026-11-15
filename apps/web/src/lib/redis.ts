import Redis from "ioredis";
import { env } from "./env";

let handle: Redis | null = null;

/** One Redis connection per server process; lazy so build-time imports stay safe. */
export function createRedis(): Redis {
  if (!handle) {
    handle = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  return handle;
}
