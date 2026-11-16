# 02 — API Gateway and Key Pooling

**Status:** Proposed. **Service:** `apps/gateway` (Hono on Node 24, undici, Drizzle, PostgreSQL 16, Redis 7).

> Supply: the project owner confirmed on 2026-11-14 that OpenCode's terms permit pooled resale (doc 00, F1 and ADR-001). OpenCode Go is the launch upstream; the design still treats it as one replaceable provider.

---

## 1. Responsibilities and boundaries

The gateway does five things: authenticate a virtual key, authorise the request against the plan, pick an upstream key, stream the response through untouched, and meter it. It does not manage users, plans or payments (that is `apps/web`), and it holds no business state in memory beyond short caches.

```
client ──► [auth] ─► [authorise] ─► [rate limit] ─► [reserve] ─► [route + pool] ─► upstream
                                                                        │
client ◄── headers + passthrough stream ◄── [usage tee] ◄───────────────┘
                                                 │
                                         [settle: PG txn + Redis release]
```

---

## 2. Public API surface

All four upstream protocols are exposed, because OpenCode Go's models are split across them (doc 00, F2).

| Route | Protocol | Upstream (OpenCode Go) |
|-------|----------|------------------------|
| `POST /v1/chat/completions` | OpenAI Chat Completions | `https://opencode.ai/zen/go/v1/chat/completions` |
| `POST /v1/messages` | Anthropic Messages | `https://opencode.ai/zen/go/v1/messages` |
| `POST /v1/responses` | OpenAI Responses | `https://opencode.ai/zen/go/v1/responses` |
| `POST /v1beta/models/{model}:streamGenerateContent`, `:generateContent` | Google Generative AI | `https://opencode.ai/inference/go/google/v1beta/…` |
| `GET /v1/models` | OpenAI list shape | Served from our DB, filtered by plan |
| `GET /v1/subscription/status` | DeepCode | §8 |
| `GET /v1/sync/manifest` | DeepCode | Skills/MCP manifest (doc 01 §8.2) |
| `GET /healthz`, `GET /readyz` | — | Liveness / readiness (PG + Redis reachable) |
| `POST /internal/invalidate` | Internal | web → gateway cache bust; `GATEWAY_INTERNAL_TOKEN` + private network only |

Upstream base URLs are taken from ZCodium's built-in provider config and **must be re-verified against OpenCode's current documentation in Phase 1**; they live in the `upstream_providers` table, not in code.

Auth header accepted per protocol convention: `Authorization: Bearer sk-dc-…`, `x-api-key: sk-dc-…` (Anthropic style), or `x-goog-api-key` (Google style). Query-string keys are rejected.

---

## 3. Database schema (PostgreSQL + Drizzle)

Package: `packages/db`. Money and credits are `bigint`. All timestamps `timestamptz`. IDs are UUIDv7 (time-ordered) unless noted.

```ts
// packages/db/src/schema.ts  (shape, not final code)

users: {
  id, email (citext, unique), emailVerifiedAt, name, passwordHash (nullable for OAuth),
  locale ('ar' | 'en'), role ('user' | 'admin'), status ('active' | 'suspended'),
  createdAt, updatedAt
}

plans: {
  id (text, e.g. 'pro-monthly'), tier ('free'|'starter'|'pro'|'team'),
  nameEn, nameAr, priceCents (int), currency (char(3)), interval ('month'|'year'),
  creditsPerPeriod (bigint), rpmLimit (int), maxConcurrentStreams (int),
  allowedModels (text[]),            // model ids; '*' not allowed, explicit list only
  fallbackEnabled (bool), maxKeys (int), maxDevices (int),
  isPublic (bool), sortOrder (int), createdAt, updatedAt
}

subscriptions: {
  id, userId → users, planId → plans,
  status ('trialing'|'active'|'past_due'|'canceled'|'expired'),
  currentPeriodStart, expiresAt,                 // access ends at expiresAt
  creditsLimit (bigint),                         // copied from plan at period start (+ adjustments)
  creditsUsed (bigint, default 0),               // ONLY the gateway increments this
  billingProvider ('stripe'|'lemonsqueezy'|'moyasar'|'manual'), providerSubscriptionId,
  cancelAtPeriodEnd (bool), createdAt, updatedAt
  // unique partial index: one row per user where status in ('trialing','active','past_due')
  // CHECK (creditsUsed >= 0)
}

virtual_api_keys: {
  id, userId → users, subscriptionId → subscriptions (nullable),
  keyHash (bytea, unique),                       // HMAC-SHA256(KEY_HASH_PEPPER, fullKey)
  keyPrefix (text), last4 (text),                // 'sk-dc-Ab3x', '…9fQ2' for display
  name, kind ('desktop'|'api'), deviceId → devices (nullable),
  status ('active'|'revoked'), lastUsedAt, expiresAt (nullable),
  createdAt, revokedAt
}

devices: { id, userId, name, os, appVersion, lastSeenAt, createdAt }

desktop_auth_codes: {
  codeHash (bytea, pk), userId, state, codeChallenge, expiresAt, consumedAt
}

upstream_providers: {
  id (text, 'opencode-go'), displayName, authScheme ('bearer'|'x-api-key'|'x-goog-api-key'),
  baseUrls (jsonb: per UpstreamApiType), enabled, isFallback (bool), priority (int)
}

upstream_pool_keys: {
  id, providerId → upstream_providers, label,          // 'go-account-03'
  keyCiphertext (bytea), keyNonce (bytea), keyVersion (int),   // AES-256-GCM, envelope
  keyFingerprint (text),                                // first 8 hex of SHA-256, for admin display
  status ('active'|'disabled'|'auth_failed'),
  weight (int, default 1), maxConcurrency (int, default 8),
  supportedModels (text[], nullable = all),
  total429 (bigint), total5xx (bigint), totalRequests (bigint),   // flushed from Redis every 60 s
  lastErrorAt, lastErrorCode, lastUsedAt, notes, createdAt, updatedAt
}

model_routes: {
  model (text, pk part), providerId → upstream_providers (pk part),
  apiType (UpstreamApiType), upstreamModel (text), priority (int), enabled (bool)
}

model_prices: {
  model (pk), inputPerMTok (bigint credits), cachedInputPerMTok, outputPerMTok,
  effectiveFrom (pk part)
}

usage_logs: {                                            // PARTITION BY RANGE (createdAt), monthly
  id, requestId (unique per partition), userId, keyId, subscriptionId,
  poolKeyId, providerId, model, apiType,
  inputTokens, cachedInputTokens, outputTokens, reasoningTokens (int),
  creditsCharged (bigint), estimated (bool),
  status ('ok'|'client_abort'|'upstream_error'|'rejected'),
  httpStatus (int), ttfbMs, durationMs, retries (smallint), createdAt
  // indexes: (userId, createdAt desc), (keyId, createdAt desc), (poolKeyId, createdAt desc)
  // NO prompt or completion content is ever stored
}

usage_daily: { userId, day, model, requests, inputTokens, outputTokens, creditsCharged }   // rollup, pk (userId, day, model)

credit_adjustments: { id, subscriptionId, deltaCredits, reason, adminId, createdAt }        // audit trail
billing_events: { id, provider, providerEventId (unique), type, payload (jsonb), processedAt } // webhook idempotency
audit_logs: { id, actorId, action, targetType, targetId, metadata (jsonb), ip, createdAt }
```

Database roles: `gateway_rw` may `SELECT` everything it needs, `INSERT` into `usage_logs`, and `UPDATE` only `subscriptions.creditsUsed`, `virtual_api_keys.lastUsedAt` and the health columns of `upstream_pool_keys`. It cannot read `users.passwordHash` (column grant) or write plans. `web_rw` cannot read `keyCiphertext` except through the admin create path, which only writes it.

### Redis keys

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `vk:{keyHashHex}` | hash | 30 s | Auth snapshot: user, subscription, plan limits, credits |
| `rl:{keyId}` | zset | 60 s | Sliding-window RPM |
| `cc:{subscriptionId}` | int | — | Concurrent stream count |
| `rsv:{subscriptionId}` | int | 10 min | Sum of in-flight credit reservations |
| `pool:inflight:{poolKeyId}` | int | — | In-flight requests per pool key |
| `pool:cool:{poolKeyId}` | string | cooldown | Presence = cooling down |
| `pool:fail:{poolKeyId}` | int | 10 min | Consecutive failure count for backoff |
| `pool:stat:{poolKeyId}:{yyyymmddhhmm}` | hash | 48 h | Per-minute 2xx/429/5xx counts for the admin health view |
| `pool:keys` | cached list | 15 s | Decrypted keys are **not** in Redis; this holds ids and metadata only |

---

## 4. Virtual API keys

**Format:** `sk-dc-` + 43 characters of base62 from 32 random bytes (`crypto.randomBytes`). 256 bits of entropy, so a fast keyed hash is sufficient; a slow password hash would add latency for no security gain.

**Issuance (web):** generate → compute `HMAC-SHA256(pepper, key)` → store hash, `keyPrefix` (first 10 chars), `last4` → return the full key **once**. Rotation creates a new key and revokes the old one in a single transaction, with an optional 24-hour overlap for API-kind keys.

**Validation middleware, in order.** Each step returns a typed `GatewayError` and stops.

| # | Check | Failure | HTTP |
|---|-------|---------|------|
| 1 | Header present, prefix `sk-dc-`, length valid | `invalid_api_key` | 401 |
| 2 | Lookup `vk:{hash}` in Redis; on miss, one indexed PG query joining key → subscription → plan, then cache. Unknown hashes are negatively cached for 10 s | `invalid_api_key` | 401 |
| 3 | Key `status = active`, not past `expiresAt`; user `status = active` | `key_revoked` | 401 |
| 4 | Subscription status in (`trialing`, `active`) **and** `expiresAt > now()` (`past_due` gets a 3-day grace, configurable) | `subscription_expired` | 402 |
| 5 | Requested model ∈ `plan.allowedModels` and has an enabled route | `model_not_allowed` | 403 |
| 6 | `creditsLimit − creditsUsed − reservations > 0` | `quota_exhausted` | 402 |
| 7 | Sliding-window RPM (Lua: `ZREMRANGEBYSCORE`, `ZCARD`, conditional `ZADD`, atomic) | `rate_limited` + `Retry-After` | 429 |
| 8 | Concurrent streams ≤ `plan.maxConcurrentStreams` | `rate_limited` | 429 |

Comparison of hashes is constant-time. Failed-auth attempts are rate-limited per IP (20/min) to blunt key guessing and to protect Postgres from miss storms.

**Cache invalidation:** `apps/web` calls `POST /internal/invalidate` on key revoke, plan change, subscription change and manual credit adjustment. The 30-second TTL is the backstop. Worst-case staleness for a revoked key is 30 s if the call fails; revocation writes also publish on a Redis channel that every gateway instance subscribes to.

---

## 5. Upstream key pooling engine

### 5.1 Selection
1. Resolve `model_routes` for the requested model → ordered candidates `(provider, apiType, upstreamModel)`; non-fallback providers first.
2. For the first provider, list pool keys with `status = active`, model supported, no `pool:cool` entry, `inflight < maxConcurrency`.
3. Choose **least-loaded**: lowest `inflight / weight`; ties broken by least-recently-used. This is done in one Lua script that also increments the chosen key's in-flight counter, so two concurrent requests cannot both pick the "last free slot".
4. If the list is empty, move to the next provider (fallback only if `plan.fallbackEnabled`). If nothing is available: `503 upstream_unavailable` with `Retry-After` set to the soonest cooldown expiry.

Pure round-robin is available as a per-provider setting, but least-loaded is the default because streams have very uneven durations.

### 5.2 Failure handling

| Upstream result | Action on the pool key | Request |
|-----------------|-----------------------|---------|
| 2xx | reset failure count | stream through |
| 429 | cooldown = `Retry-After` if present, else 30 s × 2^(consecutive 429s), capped at 10 min; count `429` | retry on next key |
| 500/502/503/504, connect/TLS error, TTFB timeout | failure count +1; cooldown 5 s × 2^n capped at 5 min | retry on next key |
| 401/403 | `status = auth_failed`, removed from rotation, **admin alert** (the account may be banned or the key rotated) | retry on next key |
| 400/404/422 | none; this is the client's request | return sanitized error, no retry |
| Stream breaks after first byte | failure count +1 | terminate stream with protocol-appropriate error event; **no retry**; meter what was delivered |

Limits: at most 3 attempts per request and a 10-second total budget before the first byte. A half-open probe lets one request through after a cooldown expires; success closes the breaker.

### 5.3 Key handling
- Keys are decrypted with `POOL_KEY_ENCRYPTION_KEY` (AES-256-GCM, per-row nonce, `keyVersion` for rotation) into an in-process map refreshed every 15 s. Plaintext exists only in gateway memory.
- The upstream request is built from an explicit header allowlist; the client's `Authorization` is dropped and replaced. Nothing is forwarded by default.
- The pool key object has a custom `toJSON`/`inspect` that prints only the fingerprint, so an accidental log of the object cannot leak it.

### 5.4 Fairness
One heavy subscriber cannot occupy the pool: `maxConcurrentStreams` per plan, RPM per key, and a global soft cap that sheds free-tier requests first when pool utilisation exceeds 85%.

---

## 6. Streaming and token metering

### 6.1 Passthrough
`undici.request` returns a body stream; it is piped to the client response with a `TransformStream` whose transform enqueues each chunk **unchanged and synchronously**, then hands a reference to the parser. No JSON re-serialisation on the hot path, no awaiting inside the transform. Backpressure flows end to end. Compression is disabled toward the client for event streams; `X-Accel-Buffering: no` and `Cache-Control: no-store` are set.

Client disconnect aborts the upstream request via `AbortController` so tokens stop being generated.

### 6.2 Usage extraction per protocol

| Protocol | Request mutation | Where usage appears | Fields |
|----------|------------------|---------------------|--------|
| Chat Completions | If `stream: true`, set `stream_options.include_usage = true` (remember whether the client had set it) | Final chunk with `choices: []` and `usage` before `[DONE]` | `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` |
| Anthropic Messages | none | `message_start.message.usage` (input, cache read/creation) and cumulative `message_delta.usage.output_tokens` | `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` |
| Responses | none | `response.completed` event → `response.usage` | `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens` |
| Google Generative AI | none | `usageMetadata` on chunks (last one is authoritative) | `promptTokenCount`, `cachedContentTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount` |
| Any, non-streaming | none | `usage` / `usageMetadata` in the JSON body | as above |

The parser is an incremental SSE line splitter that only `JSON.parse`s events that can contain usage (cheap substring test first). Field names follow each provider's public API and are locked down by recorded-fixture tests in Phase 1, including upstream models that deviate.

If the gateway injected `include_usage` and the client had not asked for it, the usage-only chunk is **withheld** from the client so strict clients do not see an unexpected `choices: []` chunk. This is the only chunk ever modified.

### 6.3 When usage is missing
Client abort, upstream crash, or an upstream model that omits usage: the request is settled with an **estimate** (input tokens from a tokenizer approximation of the request body computed off the hot path; output tokens from bytes delivered) and `estimated = true`. Estimates are visible in the admin panel so a model that never reports usage is noticed and fixed, rather than silently under-billed.

### 6.4 Credit cost
```
credits = ceil( (input − cachedInput) × inputPerMTok
              + cachedInput × cachedInputPerMTok
              + output × outputPerMTok ) / 1_000_000
```
Reasoning tokens are billed as output. Prices come from `model_prices` (cached 60 s).

### 6.5 Reservation and atomic settlement
- **Before** the upstream call: reserve `min(estimatedMaxCost, remaining)` in `rsv:{subscriptionId}`. This stops ten parallel requests from all passing the balance check with one credit left.
- **After** the stream ends, one transaction:

```sql
UPDATE subscriptions
   SET credits_used = credits_used + $cost, updated_at = now()
 WHERE id = $subscriptionId
 RETURNING credits_limit, credits_used;

INSERT INTO usage_logs (..., request_id, ...) VALUES (...)
ON CONFLICT (request_id, created_at) DO NOTHING;
```

The single-row `UPDATE … RETURNING` is atomic under row locking, with no read-modify-write in application code. `request_id` uniqueness makes settlement idempotent if it is retried. Then: release the reservation, decrement counters, refresh `vk:{hash}` with the returned balance.

- **Overdraft policy:** a request that starts with a positive balance is allowed to finish, so a balance can go slightly negative; the next request is rejected. Cutting a stream mid-answer is a worse experience than a few cents of overdraft, which is bounded by `max_tokens`.
- **Settlement failure** (Postgres unavailable): the settlement record goes to a Redis stream `settle:pending`; a worker drains it with the same idempotent transaction. Usage is never dropped.

### 6.6 Response headers
Set on **every** response, including errors after authentication:

| Header | Value |
|--------|-------|
| `X-Credits-Remaining` | integer credits (pre-request snapshot on streams) |
| `X-Usage-Percentage` | `0`–`100`, one decimal |
| `X-Subscription-Expires` | ISO-8601 UTC |
| `X-Plan-Name` | plan id (ASCII; display names come from `/v1/subscription/status`, because Arabic text is not valid in a header value) |
| `X-Request-Id` | UUIDv7, also in every error body and log line |
| `X-RateLimit-Limit` / `-Remaining` / `-Reset` | RPM window |

`Access-Control-Expose-Headers` lists them all. After the final upstream chunk and before `[DONE]` (or the protocol's terminal event), the gateway writes `: deepcode-usage {StreamUsageNotice}\n\n`, an SSE comment that carries the exact post-request balance.

---

## 7. Error sanitisation (the leak boundary)

- Upstream error bodies are **never** forwarded verbatim. They are mapped to a `GatewayError` with our own message. The raw upstream body is logged server-side after passing through a redactor that masks anything matching known key patterns and the live set of pool-key fingerprints.
- Upstream response headers are allowlisted (`content-type`, and protocol-required ones). `set-cookie`, `server`, `x-request-id` from upstream, account or organisation headers are dropped.
- A global error handler guarantees no stack trace, env value or connection string reaches a response body.
- A unit test feeds synthetic upstream errors that echo the Authorization header back and asserts the client response contains no substring of any pool key (doc 04 §3).

---

## 8. `GET /v1/subscription/status`

**Auth:** virtual key (same middleware steps 1–3; steps 4–8 are skipped so an expired or exhausted user can still read their status). **Rate limit:** 30/min per key. **Cache:** `Cache-Control: no-store`.

**200:**
```json
{
  "plan": { "id": "pro-monthly", "tier": "pro", "name": { "en": "Pro", "ar": "احترافي" } },
  "status": "active",
  "credits": { "limit": 20000000, "used": 7412350, "remaining": 12587650, "percentUsed": 37.1 },
  "period": { "startsAt": "2026-11-01T00:00:00Z", "expiresAt": "2026-12-01T00:00:00Z", "daysLeft": 17 },
  "limits": { "rpm": 60, "allowedModels": ["glm-5.3", "kimi-k3", "deepseek-v4-pro"] },
  "lock": null,
  "serverTime": "2026-11-14T10:22:31Z"
}
```

- `daysLeft` = `ceil((expiresAt − now) / 86400 s)`, floor 0. Provided for convenience; the desktop recomputes from `expiresAt` and `serverTime`.
- `lock` is non-null when the user cannot make model requests: `{ "reason": "quota_exhausted" | "expired" | "suspended" | "payment_failed", "renewUrl": "https://…/dashboard/billing?…" }`.
- A user with no subscription gets the free plan (if one is configured) or `status: "expired"` with a lock.
- Errors: `401 invalid_api_key | key_revoked`, `429 rate_limited`, `503 internal` (dependency down).

---

## 9. Observability and operations

- Structured JSON logs with `requestId`, `userId`, `keyId`, `poolKeyId` (id, never the key), model, status, TTFB, duration, retries. No request or response bodies.
- Metrics (Prometheus/OTLP): request rate and latency by route, TTFB overhead vs upstream, active streams, pool utilisation, 429/5xx per pool key, keys in cooldown, settlement queue depth, estimated-usage ratio.
- Alerts: all pool keys cooling for > 60 s; any key `auth_failed`; settlement queue > 100; estimated-usage ratio > 2%; gateway p99 overhead > 100 ms.
- Deploy: container, 2+ instances behind a load balancer with idle timeout ≥ 10 min for long streams; graceful shutdown drains streams for up to 120 s.

## 10. Phase 1 as built — deviations from the sections above

Recorded 2026-11-14 while implementing. Where this section and the sections above disagree, this section is current.

| Area | Original plan | As built, and why |
|------|---------------|-------------------|
| Upstream URLs | `https://opencode.ai/zen/go/v1` (from ZCodium's config) | `https://opencode.ai/inference/go/{openai/v1, anthropic/v1, google/v1beta}` per the Go docs read 2026-11-14. Stored in `upstream_providers.base_urls`, not code |
| Protocol per model | Model routed to its native API type | The gateway forwards upstream **in the protocol the client used**; the Go docs state every text model works through every API. `model_routes.api_type` records the native API for information only. No translation layer |
| 429 handling | Cooldown per pool key | Cooldown per **(pool key, model)**. Go limits are monthly dollar amounts per model with 5-hour and weekly windows, so one model's exhaustion does not block the account's other models. 5xx and network errors still cool the whole key |
| Key selection ties | Least in-flight / weight, then LRU | At idle every score is 0, so weight had no effect. Ties now go to the higher weight, then LRU |
| Breaker | Half-open single probe | Cooldown simply expires; the next failure doubles it (5 s → 5 min). Simpler, same effect at our scale |
| Retry budget | 3 attempts within 10 s total | 3 attempts; per-attempt header timeout 30 s for streams, 120 s for non-streaming (non-streaming headers arrive only after generation finishes, so a 10 s budget would fail long answers) |
| Upstream headers | Bearer for all | Per protocol convention: `Authorization: Bearer` (OpenAI APIs), `x-api-key` (Anthropic), `x-goog-api-key` (Google). The Go docs do not state the scheme — **verify with a live key** |
| Session id | — | `x-opencode-session` (the Go usage policy asks for a stable session id): HMAC of the user id, 32 hex chars, stable per subscriber, reveals nothing about them. User agent `DeepCodeStudio-Gateway/<version>` |
| Settlement | One transaction per request after the stream | **Write-ahead + batch.** Load testing showed per-request transactions serialise on the subscriber's `subscriptions` row and starve the connection pool at 150 concurrent streams. Now: record appended to Redis stream `settle:pending` → committed in batches every 100 ms (one multi-row insert, pre-aggregated daily rollup, one `UPDATE … RETURNING` per subscription in id order) → stream entry deleted. A drainer settles entries older than 30 s (crashed instance or failed batch). Still idempotent on `request_id` |
| Usage notice timing | After the stream | The terminal event (`[DONE]`, `message_stop`, `response.completed`) is held until settlement returns or `settleWaitMs` (1.5 s) passes, so the notice carries the committed balance. On timeout it carries snapshot − charge, and settlement completes in the background |
| Upstream 4xx | Our own message only | Our message **plus** the upstream `error.message` field after redaction (registered secrets, any 32+ character token-like string), truncated to 500 characters. Agents need errors like "context too long" to recover. Raw bodies are never forwarded; the leak test covers this path |
| Subscription rules | — | `canceled` keeps access until `expires_at`; `past_due` keeps access until `expires_at + plan.past_due_grace_hours` |
| Output cap | — | `plans.max_output_tokens` clamps `max_tokens` / `max_completion_tokens` / `max_output_tokens` / `generationConfig.maxOutputTokens` |
| Google streaming | — | Only `alt=sse` is supported; the JSON-array stream format is refused with 400 |
| Schema | — | `virtual_api_keys.subscription_id` dropped (the live subscription is resolved per user: one source of truth); `upstream_providers.auth_scheme` dropped, `session_header` added; `key_hash` is lowercase hex text; unique `lower(email)` index instead of `citext` |
| Snapshot cache | 30 s TTL | Plus in-process single flight: concurrent misses for one key make one query |
| Admission | Separate RPM, concurrency and reservation steps | One atomic Lua script (`ADMIT`), all-or-nothing: a rejected request records nothing, so there is no partial-admission cleanup. Hot path is now 3 Redis round trips (snapshot, admit, pool select), down from 8 |
| Failed-auth throttle | Checked before every lookup | Counted and checked only on the failure path: valid keys pay nothing, and a valid user sharing an IP (NAT) with a key-guesser is not locked out |
| Pool success bookkeeping | Awaited | Fire-and-forget after the upstream responds; never delays the client |
| Not yet built | — | `GET /v1/sync/manifest` (moved to Phase 2b with the marketplace tables); Postgres role grants (`infra` script, environment-specific); Prometheus metrics endpoint |
| **Closed 2026-11-14:** role grants | Environment-specific infra script | `packages/db/src/scripts/roles.ts` — idempotent `gateway_rw`/`web_rw` NOLOGIN group roles with column-level grants; run after migrations (`pnpm --filter @deepcode/db roles`); `ensure_usage_log_partitions` grants future partitions to both roles when they exist. Tested in `packages/db/test/roles.test.ts` |
| **Closed 2026-11-14:** metrics | Prometheus/OTLP | `GET /metrics` in Prometheus text via prom-client: token-protected on the main port, plus an optional unauthenticated listener on `GATEWAY_METRICS_PORT` (bind to the private network only). Series: settlement pending/dead-letter depth, pool keys by status (incl. cooling, read from Redis at scrape time), per-pool-key request outcome totals, request counts and duration histogram by route |
| **Built 2026-11-15:** `GET /v1/sync/manifest` | Phase 2b, gateway | Device-key auth, tier-filtered per requester, `ETag: rev:<n>` + `If-None-Match` → 304, 30/min rate limit. **Per-item Ed25519 signatures** instead of a manifest-level one: the payload is per-requester, so only item signatures can be produced at publish time (see doc 01 §8.2 as built) |
| **Built 2026-11-15:** DB roles / sandbox evidence | §3 grants | `gateway_rw`/`web_rw` NOLOGIN groups; `ensure_usage_log_partitions` is `SECURITY DEFINER` with `EXECUTE` revoked from PUBLIC and granted to `gateway_rw` (the gateway calls it at start and every 6 h) |

## 11. Trade-offs to revisit

| Decision | Cost accepted now | Revisit when |
|----------|-------------------|--------------|
| Auth snapshot cached 30 s | Revocation can lag up to 30 s if pub/sub is missed | Abuse is observed |
| Settle after stream | Small overdraft possible | Average overdraft is material |
| Batched settlement (100 ms) | Balance in Postgres lags by up to one batch; Redis is the write-ahead log | Redis durability (AOF) is not acceptable to finance |
| Single region | Latency for distant users | > 30% of traffic outside the region |
| Estimates on abort | Slight inaccuracy, flagged | Estimated ratio stays above 2% |
| Redis as single coordination point | Redis outage = fail closed for rate limiting (configurable to fail open for paid tiers) | Multi-region |

## Addendum 2026-11-16 — Synthetic.new replaces OpenCode as the upstream

Owner decision: OpenCode providers and keys are disabled; Synthetic.new is the only
upstream (priority 1). Docs read the same day: dev.synthetic.new/docs (overview, models,
quotas, search) and synthetic.new/pricing/models.

- **Endpoints.** OpenAI-compatible `https://api.synthetic.new/openai/v1`, Anthropic-compatible
  `https://api.synthetic.new/anthropic/v1`; `GET /v2/quotas` (free) and `POST /v2/search`
  (subscription only) on the same host.
- **Branded models** (`packages/db/src/catalog.ts` `SYNTHETIC_MODELS`): clients only see
  `deepcode-*` ids; each maps to a Synthetic alias or `hf:` model in `model_routes`, so
  upstream rotations never reach clients. Starter: default, fast-agent, mid, lite, general,
  background. Pro/Team add architect and coder-pro.
- **Credits = Synthetic's subscription-discounted rate** (1 credit = $0.000001 of weekly
  allowance); cached input at 25% of input (75% discount on cache hits).
- **`infinite:`** (`deepcode-background`): price 0; the gateway forces `stream: true`
  upstream and, for non-streaming chat-completions callers, assembles the SSE into one
  `chat.completion` (content, reasoning, merged tool calls, usage).
- **`fast:`** prefix: Team tier only, 2× credits, rejected with `infinite:` models.
- **Key pool.** `SYNTHETIC_API_KEYS="syn_a,syn_b"` seeds encrypted pool keys on every gateway
  start (new fingerprints only); admins add/disable keys live. Upstream 402 (no
  subscription/credits on that key) now cools the key and fails over like 429/5xx.
- **Quota telemetry.** The gateway polls `/v2/quotas` per Synthetic key every 15 min
  (`QUOTA_POLL_INTERVAL_MS`), stores remaining % and `renewsAt` on `upstream_pool_keys`
  (migration 0013), shows gauges in /admin/pool, and posts to `QUOTA_ALERT_WEBHOOK_URL`
  (once per key per day) below 20% or within 72 h of renewal.
- **Web search.** `POST /v1/tools/web-search {query}` → `/v2/search` with a pool key;
  needs an active plan, no credits.
- **Prompt caching.** The gateway never touches `system`/`messages`/`tools` and adds no
  per-request headers; a test asserts byte-identical upstream bodies across turns.
- **Not done:** embeddings route (`/v1/embeddings`) — the gateway has no embeddings adapter yet.
- **Verification:** `pnpm verify:synthetic` (quotas, chat+stream+usage, tool round trip,
  infinite stream, gateway end to end with `DEEPCODE_TEST_KEY`).
