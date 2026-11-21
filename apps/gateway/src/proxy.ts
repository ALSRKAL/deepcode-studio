import { createHmac } from "node:crypto";
import type { Context } from "hono";
import { request, type Agent, type Dispatcher } from "undici";
import {
  computeCredits,
  percentUsed,
  STREAM_USAGE_COMMENT_PREFIX,
  USAGE_HEADERS,
  uuidv7,
  type ModelPrice,
  type StreamUsageNotice,
  type TokenUsage,
} from "@deepcode/shared";
import { assertCanSpend, remainingCredits, type AuthSnapshot, type Authenticator, type SubscriptionSnapshot } from "./auth.js";
import type { Catalog, Route } from "./catalog.js";
import type { GatewayConfig } from "./config.js";
import { errorResponse, GatewayHttpError } from "./errors.js";
import { contextTooLargeMessage, shrinkToFit } from "./oversize.js";
import {
  clientIp,
  parseRetryAfter,
  rateHeaders,
  readJsonBody,
  sanitizeUpstreamMessage,
  usageHeaders,
} from "./http.js";
import type { Limits, RateResult } from "./limits.js";
import type { Logger, SecretRegistry } from "./logger.js";
import type { Balance, Settlement, SettlementRecord } from "./metering.js";
import type { PoolKey, PoolManager } from "./pool.js";
import type { SyncService } from "./sync.js";
import { estimateInputTokens } from "./tokenEstimate.js";
import { aggregateChatCompletionStream, FAST_MODE_MULTIPLIER, FAST_PREFIX, isInfiniteModel } from "./synthetic.js";
import { SseFramer, type PreparedBody, type ProtocolAdapter, type RequestContext } from "./protocols/index.js";
import {
  classifyBackendError,
  isContextOverflowMessage,
  isUpstreamErrorPayload,
  normalizeStreamErrorEvent,
  parseJson,
  probeEventStream,
  replayBody,
  upstreamErrorMessage,
} from "./upstreamErrors.js";

/** "Context limit exceeded: …" plus the provider's own token counts, which agents read. */
function contextOverflowMessage(upstreamText: string, secrets: SecretRegistry): string {
  const detail = sanitizeUpstreamMessage(upstreamText.trim().startsWith("{") ? upstreamText : JSON.stringify({ error: upstreamText }), secrets)
    .replace(/^The model provider rejected the request: /, "");
  return `Context limit exceeded: ${detail} Compact the conversation and retry.`;
}

function emptyIterator(): AsyncIterator<Buffer> {
  return { next: async () => ({ value: undefined, done: true }) };
}

/** Wait before retrying a backend error; resolves early when the client goes away. */
function backoff(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}
export interface ProxyDeps {
  config: GatewayConfig;
  auth: Authenticator;
  limits: Limits;
  pool: PoolManager;
  catalog: Catalog;
  settlement: Settlement;
  /** Skills/MCP sync manifest service (GET /v1/sync/manifest). */
  sync: SyncService;
  logger: Logger;
  secrets: SecretRegistry;
  agent: Agent;
  now: () => number;
  streams: { active: number };
  /** Optional Prometheus observer; the proxy works without it (tests, tools). */
  metrics?: {
    observeInput(model: string, tokens: number): void;
    observeContextRejection(model: string): void;
  };
}

const USER_AGENT = "DeepCodeStudio-Gateway/0.1";
const DEFAULT_OUTPUT_ESTIMATE = 4_096;
/** Client headers that may be forwarded upstream. Everything else is dropped. */
const FORWARDED_CLIENT_HEADERS = ["anthropic-version", "anthropic-beta"];

interface Upstream {
  res: Dispatcher.ResponseData;
  key: PoolKey;
  route: Route;
  prepared: PreparedBody;
  releaseKey: () => Promise<void>;
  attempts: number;
  ttfbMs: number;
}

/**
 * Session id sent upstream (OpenCode asks for a stable x-opencode-session):
 * stable per subscriber, derived with the pepper so it reveals nothing about them.
 */
function sessionId(deps: ProxyDeps, userId: string): string {
  return createHmac("sha256", deps.config.pepper).update(`session:${userId}`).digest("hex").slice(0, 32);
}

export async function handleProxy(
  c: Context,
  adapter: ProtocolAdapter,
  deps: ProxyDeps,
  path: { model?: string; method?: string } = {},
): Promise<Response> {
  const requestId = uuidv7(deps.now());
  const startedAt = deps.now();
  const log = deps.logger.child({ requestId, apiType: adapter.apiType });
  const cleanups: Array<() => Promise<void>> = [];
  const cleanup = async () => {
    while (cleanups.length) {
      try {
        await cleanups.pop()!();
      } catch (err) {
        log.error("cleanup failed", { err });
      }
    }
  };

  let snapshot: AuthSnapshot | null = null;
  let rate: RateResult | null = null;
  const upstreamAbort = new AbortController();
  const onClientAbort = () => upstreamAbort.abort();
  c.req.raw.signal?.addEventListener("abort", onClientAbort, { once: true });

  // Phase timings (ms since the handler started), logged at debug for latency work.
  const t0 = performance.now();
  const phases: Record<string, number> = {};
  const mark = (name: string) => {
    phases[name] = Math.round((performance.now() - t0) * 10) / 10;
  };

  try {
    snapshot = await deps.auth.authenticate(c.req.raw, clientIp(c, deps.config.trustProxy));
    mark("auth");
    const sub = assertCanSpend(snapshot, deps.now(), deps.config.webOrigin);
    // Read up to the hard cap; a body over the normal limit is shrunk (older images
    // replaced by a note) instead of being refused (oversize.ts).
    const read = await readJsonBody(c.req.raw, deps.config.maxRequestBodyHardBytes);
    const json = read.json;
    let bytes = read.bytes;
    if (bytes > deps.config.maxRequestBodyBytes) {
      const shrunk = shrinkToFit(json, deps.config.maxRequestBodyBytes);
      if (!shrunk.ok) throw new GatewayHttpError("context_length_exceeded", contextTooLargeMessage(shrunk.bytes));
      log.info("oversized request shrunk", { fromBytes: bytes, toBytes: shrunk.bytes, removedImages: shrunk.removedImages });
      bytes = shrunk.bytes;
    }
    mark("body");
    const ctx: RequestContext = {
      body: json,
      headers: c.req.raw.headers,
      query: new URL(c.req.url).searchParams,
      ...(path.model !== undefined ? { pathModel: path.model } : {}),
      ...(path.method !== undefined ? { pathMethod: path.method } : {}),
    };

    const requestedModel = adapter.extractModel(ctx);
    if (!requestedModel) throw new GatewayHttpError("bad_request", "The request must name a model.");
    // `fast:<model>`: Synthetic fast mode (2x the draw), only for plans that include it.
    const fast = requestedModel.startsWith(FAST_PREFIX);
    const model = fast ? requestedModel.slice(FAST_PREFIX.length) : requestedModel;
    if (fast && !deps.config.fastModeTiers.includes(sub.plan.tier)) {
      throw new GatewayHttpError("model_not_allowed", "Fast mode is not included in your plan.");
    }
    if (!sub.plan.allowedModels.includes(model)) throw new GatewayHttpError("model_not_allowed");
    const routes = deps.catalog
      .routes(model)
      .filter((r) => r.provider.baseUrls[adapter.apiType] && (!r.provider.isFallback || sub.plan.fallbackEnabled));
    const basePrice = deps.catalog.price(model);
    if (fast && routes.some((r) => isInfiniteModel(r.upstreamModel))) {
      throw new GatewayHttpError("bad_request", "Fast mode and background (infinite) models cannot be combined.");
    }
    const price = basePrice && fast ? scalePrice(basePrice, FAST_MODE_MULTIPLIER) : basePrice;
    if (routes.length === 0 || !price || !deps.catalog.isServable(model)) {
      throw new GatewayHttpError("model_not_allowed", "This model is not currently available.");
    }
    const stream = adapter.isStream(ctx);
    if (adapter.apiType === "google-generative-ai" && stream && ctx.query.get("alt") !== "sse") {
      throw new GatewayHttpError("bad_request", "Streaming requires alt=sse.");
    }

    const inputEstimate = estimateInputTokens(json);
    deps.metrics?.observeInput(model, inputEstimate);
    const inputLimit = deps.config.maxRequestInputTokens;
    if (inputLimit > 0 && inputEstimate > inputLimit) {
      deps.metrics?.observeContextRejection(model);
      // The desktop parses `N tokens > M` out of a prompt-too-long error and drops
      // exactly that gap before retrying (compact-selection.ts). Keep the shape.
      const format = (n: number) => n.toLocaleString("en-US");
      throw new GatewayHttpError(
        "context_length_exceeded",
        `Context limit exceeded: this request is about ${format(inputEstimate)} tokens > ${format(inputLimit)} limit. Compact the conversation and retry.`,
      );
    }

    // Reservation stays on bytes/4: a conservative upper bound for text, corrected
    // by settlement. The structured estimate above is only for the hard cap.
    const reservationInput = Math.ceil(bytes / 4);
    const cap = sub.plan.maxOutputTokens;
    const requested = adapter.requestedMaxOutput(ctx);
    const outputEstimate = Math.min(requested ?? cap ?? DEFAULT_OUTPUT_ESTIMATE, cap ?? Number.POSITIVE_INFINITY);
    const reservation = computeCredits(
      { input: reservationInput, cachedInput: 0, output: outputEstimate, reasoning: 0 },
      price,
    );
    const admitted = await deps.limits.admit({
      rpmBucket: `key:${snapshot.keyId}`,
      rpmLimit: sub.plan.rpmLimit,
      subscriptionId: sub.id,
      maxStreams: sub.plan.maxConcurrentStreams,
      remainingCredits: remainingCredits(sub),
      estimate: reservation,
      requestId,
    });
    rate = admitted.rate;
    if (!admitted.ok) {
      if (admitted.reason === "rpm") {
        throw new GatewayHttpError("rate_limited", undefined, { retryAfterSec: rate.resetMs / 1000 });
      }
      if (admitted.reason === "concurrency") {
        throw new GatewayHttpError("rate_limited", "Too many concurrent requests for this plan.", { retryAfterSec: 2 });
      }
      throw new GatewayHttpError("quota_exhausted", undefined, {
        renewUrl: `${deps.config.webOrigin}/dashboard/billing?reason=quota_exhausted`,
      });
    }
    cleanups.push(admitted.release);
    mark("limits");

    const upstream = await dispatch(deps, adapter, ctx, {
      model,
      routes,
      stream,
      requestId,
      userId: snapshot.userId,
      maxOutputTokens: cap,
      fast,
      signal: upstreamAbort.signal,
      startedAt,
      log,
    });
    cleanups.push(upstream.releaseKey);
    mark("upstreamHeaders");
    // Health bookkeeping is off the hot path: the response does not wait for it.
    deps.pool.recordSuccess(upstream.key, model).catch((err) => log.warn("pool success bookkeeping failed", { err }));
    mark("ready");
    log.debug("request phases", { phases, attempts: upstream.attempts });

    const base: Omit<SettlementRecord, "usage" | "credits" | "estimated" | "status" | "httpStatus" | "durationMs"> = {
      requestId,
      createdAt: new Date(startedAt).toISOString(),
      userId: snapshot.userId,
      keyId: snapshot.keyId,
      keyHash: snapshot.keyHash,
      subscriptionId: sub.id,
      poolKeyId: upstream.key.id,
      providerId: upstream.route.provider.id,
      model,
      apiType: adapter.apiType,
      ttfbMs: upstream.ttfbMs,
      retries: upstream.attempts - 1,
    };
    const contentType = String(upstream.res.headers["content-type"] ?? "");
    const isEventStream = stream && contentType.includes("text/event-stream");
    const commonHeaders: Record<string, string> = {
      [USAGE_HEADERS.requestId]: requestId,
      "cache-control": "no-store",
      ...rateHeaders(rate),
    };

    if (!isEventStream) {
      const raw = await upstream.res.body.text();
      const assembled = contentType.includes("text/event-stream");
      const text = assembled ? JSON.stringify(aggregateChatCompletionStream(raw)) : raw;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const reported = adapter.usageFromJson(parsed);
      const usage = reported ?? { input: inputEstimate, cachedInput: 0, output: Math.ceil(text.length / 4), reasoning: 0 };
      const credits = computeCredits(usage, price);
      const balance = await settleWithin(deps, {
        ...base,
        usage,
        credits,
        estimated: !reported,
        status: "ok",
        httpStatus: upstream.res.statusCode,
        durationMs: deps.now() - startedAt,
      });
      if (!reported) log.warn("upstream returned no usage; charged an estimate", { model });
      await cleanup();
      return new Response(text, {
        status: upstream.res.statusCode,
        headers: {
          "content-type": assembled ? "application/json" : contentType || "application/json",
          ...commonHeaders,
          ...usageHeaders(sub, balance ?? { creditsLimit: sub.creditsLimit, creditsUsed: sub.creditsUsed + credits }),
        },
      });
    }

    return streamResponse(deps, adapter, {
      upstream,
      sub,
      price,
      base,
      inputEstimate,
      startedAt,
      upstreamAbort,
      cleanup,
      log,
      headers: {
        "content-type": contentType,
        "x-accel-buffering": "no",
        ...commonHeaders,
        ...usageHeaders(sub),
      },
    });
  } catch (err) {
    await cleanup();
    const gwErr =
      err instanceof GatewayHttpError
        ? err
        : (log.error("unhandled proxy error", { err }), new GatewayHttpError("internal"));
    return errorResponse(gwErr, requestId, {
      ...usageHeaders(snapshot?.subscription ?? null),
      ...rateHeaders(rate),
    });
  } finally {
    c.req.raw.signal?.removeEventListener("abort", onClientAbort);
  }
}

/**
 * Picks pool keys and retries ONLY before any byte reaches the client
 * (doc 02 §5.2): 429 cools the key for this model, 5xx/network cools the key,
 * 401/403 removes the key, other 4xx are the client's fault and are not retried.
 */
async function dispatch(
  deps: ProxyDeps,
  adapter: ProtocolAdapter,
  ctx: RequestContext,
  opts: {
    model: string;
    routes: Route[];
    stream: boolean;
    requestId: string;
    userId: string;
    maxOutputTokens: number | null;
    fast: boolean;
    signal: AbortSignal;
    startedAt: number;
    log: Logger;
  },
): Promise<Upstream> {
  const exclude = new Set<string>();
  let attempts = 0;
  let soonestCooldownMs = -1;

  for (const [routeIndex, route] of opts.routes.entries()) {
    // Backend errors on this route; after two, a plan with a fallback provider moves on.
    let routeBackendErrors = 0;
    const hasNextRoute = routeIndex < opts.routes.length - 1;
    while (attempts < deps.config.maxAttempts) {
      const sel = await deps.pool.select(route.provider.id, opts.model, opts.requestId, exclude);
      if (!sel.key) {
        if (sel.retryAfterMs > 0 && (soonestCooldownMs < 0 || sel.retryAfterMs < soonestCooldownMs)) {
          soonestCooldownMs = sel.retryAfterMs;
        }
        break;
      }
      const key = sel.key;
      exclude.add(key.id);
      attempts += 1;

      // Synthetic `infinite:` models must stream (long pauses time out otherwise);
      // a non-streaming chat-completions caller gets the chunks assembled into JSON.
      const forceStream = isInfiniteModel(route.upstreamModel) && !opts.stream;
      if (forceStream && adapter.apiType !== "openai-chat-completions") {
        await sel.release();
        throw new GatewayHttpError("bad_request", "Background models require stream: true on this endpoint.");
      }
      const upstreamStream = opts.stream || forceStream;
      const prepared = adapter.prepareBody(ctx, {
        upstreamModel: opts.fast ? `${FAST_PREFIX}${route.upstreamModel}` : route.upstreamModel,
        stream: upstreamStream,
        maxOutputTokens: opts.maxOutputTokens,
      });
      if (forceStream) prepared.body.stream = true;
      for (const field of droppedParams(route.provider.id, route.upstreamModel)) delete prepared.body[field];
      const url = route.provider.baseUrls[adapter.apiType]!.replace(/\/$/, "") +
        adapter.upstreamPath(route.upstreamModel, ctx, opts.stream);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: upstreamStream ? "text/event-stream" : "application/json",
        "user-agent": USER_AGENT,
      };
      if (route.provider.sessionHeader) headers[route.provider.sessionHeader] = sessionId(deps, opts.userId);
      Object.assign(headers, forwardedHeaders(ctx), adapter.authHeaders(key.reveal()));

      let res: Dispatcher.ResponseData;
      try {
        res = await request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(prepared.body),
          dispatcher: deps.agent,
          headersTimeout: upstreamStream ? deps.config.streamHeadersTimeoutMs : deps.config.requestTimeoutMs,
          bodyTimeout: deps.config.bodyIdleTimeoutMs,
          signal: opts.signal,
        });
      } catch (err) {
        await sel.release();
        if (opts.signal.aborted) throw new GatewayHttpError("bad_request", "Client closed the request.", { httpStatus: 499 });
        // A slow model queue is not a broken key: cooling the (only) key on a timeout
        // made every customer fail for minutes. Answer a retryable 503 instead.
        if (err instanceof Error && /HeadersTimeout|BodyTimeout/i.test(`${err.name} ${(err as { code?: string }).code ?? ""}`)) {
          opts.log.warn("upstream timed out before responding", { poolKeyId: key.id, model: opts.model, err: err.name });
          throw new GatewayHttpError("upstream_unavailable", "The model is busy right now. Retry shortly.", { retryAfterSec: 5 });
        }
        await deps.pool.recordFailure(key, err instanceof Error ? err.name : "network");
        continue;
      }

      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        // Synthetic can answer 200 with `{"error":"Error from inference backend: …"}`
        // (whole body, or the first SSE event). Look before committing: a failure that
        // produced no output is retried instead of reaching the client as a "success".
        const isSse = String(res.headers["content-type"] ?? "").includes("text/event-stream");
        let backendError: string | null = null;
        try {
          if (isSse) {
            const probe = await probeEventStream(res.body as unknown as AsyncIterable<Buffer>);
            if (probe.kind === "error") backendError = probe.message;
            else (res as { body: unknown }).body = replayBody(probe.buffered, probe.rest, probe.ended);
          } else {
            const text = await res.body.text();
            const parsed = parseJson(text);
            if (isUpstreamErrorPayload(parsed)) backendError = upstreamErrorMessage(parsed);
            else (res as { body: unknown }).body = replayBody([Buffer.from(text)], emptyIterator(), true);
          }
        } catch (err) {
          await sel.release();
          if (opts.signal.aborted) throw new GatewayHttpError("bad_request", "Client closed the request.", { httpStatus: 499 });
          if (err instanceof Error && /Timeout/i.test(`${err.name} ${(err as { code?: string }).code ?? ""}`)) {
            opts.log.warn("upstream stalled before its first event", { poolKeyId: key.id, model: opts.model });
            throw new GatewayHttpError("upstream_unavailable", "The model is busy right now. Retry shortly.", { retryAfterSec: 5 });
          }
          await deps.pool.recordFailure(key, err instanceof Error ? err.name : "network");
          continue;
        }
        if (backendError === null) {
          return { res, key, route, prepared, releaseKey: sel.release, attempts, ttfbMs: deps.now() - opts.startedAt };
        }
        await sel.release();
        // Deterministic failures are not retried: a full context asks the agent to compact,
        // a request the backend rejected is reported as such.
        const kind = classifyBackendError(backendError);
        if (kind === "context") {
          throw new GatewayHttpError("context_length_exceeded", contextOverflowMessage(backendError, deps.secrets));
        }
        if (kind === "client") {
          throw new GatewayHttpError("bad_request", sanitizeUpstreamMessage(JSON.stringify({ error: backendError }), deps.secrets));
        }
        opts.log.warn("upstream backend error in a 200 response; retrying", {
          poolKeyId: key.id,
          model: opts.model,
          attempt: attempts,
          message: sanitizeUpstreamMessage(backendError, deps.secrets).slice(0, 200),
        });
        // The model backend failed, not the key: reuse it (possibly the only one) after a pause.
        routeBackendErrors += 1;
        if (hasNextRoute && routeBackendErrors >= 2) break;
        exclude.delete(key.id);
        await backoff(400 * attempts, opts.signal);
        continue;
      }

      // 5xx from the model backend is not the key's fault: do not cool the key (with a
      // single pool key that turned one backend hiccup into minutes of outage for every
      // customer). Retry, on the same key if it is the only one, after a short pause.
      if (status >= 500) {
        await res.body.dump({ limit: 64 * 1024 }).catch(() => {});
        await sel.release();
        opts.log.warn("upstream 5xx; retrying", { poolKeyId: key.id, model: opts.model, httpStatus: status, attempt: attempts });
        routeBackendErrors += 1;
        if (hasNextRoute && routeBackendErrors >= 2) break;
        exclude.delete(key.id);
        await backoff(400 * attempts, opts.signal);
        continue;
      }

      // 402 = that upstream key has no subscription/credits left: cool it, use another.
      if (status === 429 || status === 401 || status === 402 || status === 403 || status === 408) {
        await res.body.dump({ limit: 64 * 1024 }).catch(() => {});
        await sel.release();
        if (status === 429) {
          await deps.pool.record429(key, opts.model, parseRetryAfter(res.headers["retry-after"], deps.now()));
        } else if (status === 401 || status === 403) {
          await deps.pool.recordAuthFailure(key, status);
        } else {
          await deps.pool.recordFailure(key, `http_${status}`);
        }
        continue;
      }

      // Other 4xx: the request itself is wrong. Do not retry, do not forward the raw body.
      const text = await res.body.text().catch(() => "");
      await sel.release();
      // Clients (the desktop app's reasoning toggle, other SDKs) may send an optional
      // field this upstream model does not accept ("Unrecognized request argument
      // supplied: thinking"). Drop that one optional field, remember it for the model,
      // and resend on the same key instead of failing the user's request.
      const unsupported = status === 400 ? unsupportedOptionalParam(text) : null;
      if (unsupported && unsupported in prepared.body && !droppedParams(route.provider.id, route.upstreamModel).has(unsupported)) {
        rememberDroppedParam(route.provider.id, route.upstreamModel, unsupported);
        opts.log.info("dropped unsupported optional parameter and retried", { param: unsupported, model: opts.model });
        exclude.delete(key.id);
        attempts -= 1;
        continue;
      }
      opts.log.info("upstream rejected request", { httpStatus: status, poolKeyId: key.id });
      if (status === 413) {
        throw new GatewayHttpError("context_length_exceeded", contextTooLargeMessage(JSON.stringify(prepared.body).length));
      }
      if (isContextOverflowMessage(text)) {
        throw new GatewayHttpError("context_length_exceeded", contextOverflowMessage(text, deps.secrets));
      }
      throw new GatewayHttpError("bad_request", sanitizeUpstreamMessage(text, deps.secrets), {
        httpStatus: [400, 404, 413, 422].includes(status) ? status : 400,
      });
    }
    if (attempts >= deps.config.maxAttempts) break;
  }

  throw new GatewayHttpError("upstream_unavailable", undefined, {
    retryAfterSec: soonestCooldownMs > 0 ? soonestCooldownMs / 1000 : 5,
  });
}

/** Optional top-level request fields a gateway may drop when an upstream model rejects them. */
const DROPPABLE_OPTIONAL_PARAMS = new Set([
  "thinking",
  "reasoning",
  "reasoning_effort",
  "enable_thinking",
  "thinking_budget",
  "chat_template_kwargs",
  "parallel_tool_calls",
  "top_k",
  "store",
  "metadata",
  "service_tier",
  "verbosity",
]);
const droppedByModel = new Map<string, Set<string>>();

function droppedParams(providerId: string, upstreamModel: string): ReadonlySet<string> {
  return droppedByModel.get(`${providerId}/${upstreamModel}`) ?? new Set();
}

function rememberDroppedParam(providerId: string, upstreamModel: string, param: string): void {
  const k = `${providerId}/${upstreamModel}`;
  const set = droppedByModel.get(k) ?? new Set<string>();
  set.add(param);
  droppedByModel.set(k, set);
}

/** The optional parameter an upstream 400 names as unsupported, if it is one we may drop. */
export function unsupportedOptionalParam(body: string): string | null {
  const m =
    /Unrecognized request argument supplied:\s*['"]?([A-Za-z_]+)/i.exec(body) ??
    /Unknown parameter:\s*['"]?([A-Za-z_]+)/i.exec(body) ??
    /unexpected keyword argument ['"]([A-Za-z_]+)['"]/i.exec(body) ??
    /['"]?([A-Za-z_]+)['"]? is not (?:supported|permitted|allowed)/i.exec(body) ??
    /Extra inputs are not permitted[^"]*?['"]([A-Za-z_]+)['"]/i.exec(body);
  const param = m?.[1];
  return param && DROPPABLE_OPTIONAL_PARAMS.has(param) ? param : null;
}

function forwardedHeaders(ctx: RequestContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARDED_CLIENT_HEADERS) {
    const v = ctx.headers.get(name);
    if (v) out[name] = v;
  }
  return out;
}

/**
 * Settle, but do not hold the client longer than settleWaitMs. The record is
 * written ahead to Redis inside submit(), so a timeout here never loses the charge.
 */
async function settleWithin(deps: ProxyDeps, rec: SettlementRecord): Promise<Balance | null> {
  const work = deps.settlement.submit(rec).then(async (balance) => {
    if (balance) {
      await deps.auth.updateCachedCredits(rec.keyHash, balance.creditsUsed, balance.creditsLimit).catch(() => {});
    }
    return balance;
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deps.config.settleWaitMs);
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function streamResponse(
  deps: ProxyDeps,
  adapter: ProtocolAdapter,
  s: {
    upstream: Upstream;
    sub: SubscriptionSnapshot;
    price: ModelPrice;
    base: Omit<SettlementRecord, "usage" | "credits" | "estimated" | "status" | "httpStatus" | "durationMs">;
    inputEstimate: number;
    startedAt: number;
    upstreamAbort: AbortController;
    cleanup: () => Promise<void>;
    log: Logger;
    headers: Record<string, string>;
  },
): Response {
  const state = adapter.createStreamState({ injectedUsage: s.upstream.prepared.injectedUsage });
  const framer = new SseFramer();
  const encoder = new TextEncoder();
  const iterator = (s.upstream.res.body as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  const held: string[] = [];
  let finished = false;
  let cancelled = false;
  deps.streams.active += 1;

  const finalize = async (status: SettlementRecord["status"], httpStatus: number) => {
    if (finished) return null;
    finished = true;
    const reported = state.usage();
    const usage: TokenUsage = reported ?? {
      input: s.inputEstimate,
      cachedInput: 0,
      output: state.contentEvents(),
      reasoning: 0,
    };
    const credits = computeCredits(usage, s.price);
    if (!reported) s.log.warn("stream ended without usage; charged an estimate", { model: s.base.model, status });
    const balance = await settleWithin(deps, {
      ...s.base,
      usage,
      credits,
      estimated: !reported,
      status,
      httpStatus,
      durationMs: deps.now() - s.startedAt,
    });
    await s.cleanup();
    deps.streams.active -= 1;
    const limit = balance?.creditsLimit ?? s.sub.creditsLimit;
    const used = balance?.creditsUsed ?? s.sub.creditsUsed + credits;
    const notice: StreamUsageNotice = {
      requestId: s.base.requestId,
      model: s.base.model,
      tokens: usage,
      creditsCharged: credits,
      creditsRemaining: limit - used,
      percentUsed: percentUsed(used, limit),
      estimated: !reported,
    };
    return notice;
  };

  const handle = (raw: ReturnType<SseFramer["push"]>, out: string[]) => {
    for (const original of raw) {
      // A backend error after output started: give clients the OpenAI error object
      // instead of a bare string they cannot parse.
      const normalized = adapter.apiType === "openai-chat-completions" ? normalizeStreamErrorEvent(original.data) : null;
      const ev = normalized ? { ...original, raw: normalized } : original;
      if (normalized) s.log.warn("upstream error event mid-stream", { model: s.base.model });
      const { forward, terminal } = state.onEvent(ev);
      if (!forward) continue;
      // Once a terminal event is held, everything after it is held too, to keep order.
      if (terminal || held.length > 0) held.push(ev.raw);
      else out.push(ev.raw);
    }
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done) {
            const out: string[] = [];
            const tail = framer.flush();
            if (tail) handle([tail], out);
            const notice = await finalize("ok", s.upstream.res.statusCode);
            if (out.length) controller.enqueue(encoder.encode(out.join("")));
            if (notice) controller.enqueue(encoder.encode(`${STREAM_USAGE_COMMENT_PREFIX}${JSON.stringify(notice)}\n\n`));
            if (held.length) controller.enqueue(encoder.encode(held.join("")));
            controller.close();
            return;
          }
          const out: string[] = [];
          handle(framer.push(value), out);
          if (out.length) {
            controller.enqueue(encoder.encode(out.join("")));
            return;
          }
        }
      } catch (err) {
        if (cancelled) return;
        s.log.warn("upstream stream interrupted", { poolKeyId: s.upstream.key.id, err });
        await deps.pool.recordFailure(s.upstream.key, "stream_interrupted").catch(() => {});
        await finalize("upstream_error", 502);
        try {
          controller.enqueue(encoder.encode(adapter.terminalErrorEvent()));
          controller.close();
        } catch {
          // client already gone
        }
      }
    },
    async cancel() {
      cancelled = true;
      s.upstreamAbort.abort();
      await iterator.return?.().catch(() => {});
      await finalize("client_abort", 499);
    },
  });

  return new Response(body, { status: s.upstream.res.statusCode, headers: s.headers });
}

function scalePrice(price: ModelPrice, factor: number): ModelPrice {
  return {
    ...price,
    inputPerMTok: price.inputPerMTok * factor,
    cachedInputPerMTok: price.cachedInputPerMTok * factor,
    outputPerMTok: price.outputPerMTok * factor,
  };
}
