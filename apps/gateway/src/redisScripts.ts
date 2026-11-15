import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Lua scripts that must be atomic. Each runs as one Redis command, so concurrent
 * gateway instances cannot interleave between the check and the write.
 * Dynamic key names are used in POOL_SELECT, which is fine for a single Redis
 * instance but not Redis Cluster (revisit with multi-region, doc 00 §8).
 */

/** Sliding-window counter. Returns {allowed, remaining, resetMs}. */
const RPM = `
local key = KEYS[1]
local now = tonumber(ARGV[1]); local win = tonumber(ARGV[2]); local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, win)
  return {1, limit - count - 1, win}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = win
if oldest[2] then reset = tonumber(oldest[2]) + win - now end
return {0, 0, reset}
`;

/**
 * Least-loaded pool key selection (doc 02 §5.1).
 * ARGV: now, staleMs, model, member, then triples (keyId, weight, maxConcurrency).
 * Skips keys cooling down globally or for this model; picks lowest inflight/weight,
 * ties broken by higher weight, then least recently used; registers the request as in flight.
 * Returns {chosenId or '', soonestCooldownMs or -1}.
 */
const POOL_SELECT = `
local now = tonumber(ARGV[1]); local stale = tonumber(ARGV[2]); local model = ARGV[3]; local member = ARGV[4]
local best = nil; local bestScore = 0; local bestW = 0; local bestLu = 0; local soonest = -1
for i = 5, #ARGV, 3 do
  local id = ARGV[i]; local w = tonumber(ARGV[i + 1]); local maxc = tonumber(ARGV[i + 2])
  local ttl = math.max(redis.call('PTTL', 'pool:cool:' .. id), redis.call('PTTL', 'pool:mcool:' .. id .. ':' .. model))
  if ttl > 0 then
    if soonest < 0 or ttl < soonest then soonest = ttl end
  else
    local ik = 'pool:inflight:' .. id
    redis.call('ZREMRANGEBYSCORE', ik, '-inf', now - stale)
    local n = redis.call('ZCARD', ik)
    if n < maxc then
      local score = n / w
      local lu = tonumber(redis.call('GET', 'pool:lu:' .. id) or '0')
      -- Ties (common at low load, when every score is 0) go to the heavier key,
      -- then to the least recently used one, so weight matters at every load level.
      if best == nil or score < bestScore
         or (score == bestScore and (w > bestW or (w == bestW and lu < bestLu))) then
        best = id; bestScore = score; bestW = w; bestLu = lu
      end
    end
  end
end
if best then
  redis.call('ZADD', 'pool:inflight:' .. best, now, member)
  redis.call('PEXPIRE', 'pool:inflight:' .. best, stale)
  redis.call('SET', 'pool:lu:' .. best, now)
  return {best, -1}
end
return {'', soonest}
`;

/**
 * Admission in ONE round trip, all-or-nothing (doc 02 §4 steps 6–8):
 * RPM window, concurrent-stream slot and credit reservation are all checked first;
 * only if every check passes are all three recorded. A rejected request leaves
 * nothing behind, so there is nothing to clean up.
 * KEYS: rl:{bucket}, cc:{subscription}, rsv:{subscription}
 * ARGV: now, windowMs, rpmLimit, member, staleMs, maxStreams, remainingCredits, estimate
 * Returns {code, rpmRemaining, resetMs}: code 0 ok, 1 rpm, 2 concurrency, 3 credits.
 */
const ADMIT = `
local now = tonumber(ARGV[1]); local win = tonumber(ARGV[2]); local limit = tonumber(ARGV[3])
local member = ARGV[4]; local stale = tonumber(ARGV[5]); local maxStreams = tonumber(ARGV[6])
local remaining = tonumber(ARGV[7]); local estimate = tonumber(ARGV[8])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - win)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local reset = win
  if oldest[2] then reset = tonumber(oldest[2]) + win - now end
  return {1, 0, reset}
end

redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - stale)
if redis.call('ZCARD', KEYS[2]) >= maxStreams then return {2, limit - count, win} end

local fields = redis.call('HGETALL', KEYS[3])
local total = 0
for i = 1, #fields, 2 do
  local v = fields[i + 1]
  local sep = string.find(v, ':', 1, true)
  local amount = tonumber(string.sub(v, 1, sep - 1))
  local ts = tonumber(string.sub(v, sep + 1))
  if now - ts > stale then redis.call('HDEL', KEYS[3], fields[i]) else total = total + amount end
end
local available = remaining - total
if available <= 0 then return {3, limit - count, win} end

redis.call('ZADD', KEYS[1], now, member); redis.call('PEXPIRE', KEYS[1], win)
redis.call('ZADD', KEYS[2], now, member); redis.call('PEXPIRE', KEYS[2], stale)
redis.call('HSET', KEYS[3], member, tostring(math.min(estimate, available)) .. ':' .. tostring(now))
redis.call('PEXPIRE', KEYS[3], stale)
return {0, limit - count - 1, win}
`;

/** Atomically read and delete a hash (used to flush counters). */
const HASH_TAKE = `
local v = redis.call('HGETALL', KEYS[1])
redis.call('DEL', KEYS[1])
return v
`;

const SCRIPTS = { RPM, ADMIT, POOL_SELECT, HASH_TAKE } as const;
export type ScriptName = keyof typeof SCRIPTS;

export class RedisScripts {
  readonly #sha = new Map<ScriptName, string>();

  constructor(private readonly redis: Redis) {
    for (const [name, body] of Object.entries(SCRIPTS)) {
      this.#sha.set(name as ScriptName, createHash("sha1").update(body).digest("hex"));
    }
  }

  async run<T = unknown>(name: ScriptName, keys: string[], args: Array<string | number>): Promise<T> {
    const sha = this.#sha.get(name)!;
    try {
      return (await this.redis.evalsha(sha, keys.length, ...keys, ...args)) as T;
    } catch (err) {
      if (err instanceof Error && err.message.includes("NOSCRIPT")) {
        return (await this.redis.eval(SCRIPTS[name], keys.length, ...keys, ...args)) as T;
      }
      throw err;
    }
  }
}
