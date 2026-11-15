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
import { SseFramer, type PreparedBody, type ProtocolAdapter, type RequestContext } from "./protocols/index.js";
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
    const { json, bytes } = await readJsonBody(c.req.raw, deps.config.maxRequestBodyBytes);
    mark("body");
    const ctx: RequestContext = {
      body: json,
      headers: c.req.raw.headers,
      query: new URL(c.req.url).searchParams,
      ...(path.model !== undefined ? { pathModel: path.model } : {}),
      ...(path.method !== undefined ? { pathMethod: path.method } : {}),
    };

    const model = adapter.extractModel(ctx);
    if (!model) throw new GatewayHttpError("bad_request", "The request must name a model.");
    if (!sub.plan.allowedModels.includes(model)) throw new GatewayHttpError("model_not_allowed");
    const routes = deps.catalog
      .routes(model)
      .filter((r) => r.provider.baseUrls[adapter.apiType] && (!r.provider.isFallback || sub.plan.fallbackEnabled));
    const price = deps.catalog.price(model);
    if (routes.length === 0 || !price || !deps.catalog.isServable(model)) {
      throw new GatewayHttpError("model_not_allowed", "This model is not currently available.");
    }
    const stream = adapter.isStream(ctx);
    if (adapter.apiType === "google-generative-ai" && stream && ctx.query.get("alt") !== "sse") {
      throw new GatewayHttpError("bad_request", "Streaming requires alt=sse.");
    }

    const inputEstimate = Math.ceil(bytes / 4);
    const cap = sub.plan.maxOutputTokens;
    const requested = adapter.requestedMaxOutput(ctx);
    const outputEstimate = Math.min(requested ?? cap ?? DEFAULT_OUTPUT_ESTIMATE, cap ?? Number.POSITIVE_INFINITY);
    const reservation = computeCredits(
      { input: inputEstimate, cachedInput: 0, output: outputEstimate, reasoning: 0 },
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
      const text = await upstream.res.body.text();
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
          "content-type": contentType || "application/json",
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
    signal: AbortSignal;
    startedAt: number;
    log: Logger;
  },
): Promise<Upstream> {
  const exclude = new Set<string>();
  let attempts = 0;
  let soonestCooldownMs = -1;

  for (const route of opts.routes) {
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

      const prepared = adapter.prepareBody(ctx, {
        upstreamModel: route.upstreamModel,
        stream: opts.stream,
        maxOutputTokens: opts.maxOutputTokens,
      });
      const url = route.provider.baseUrls[adapter.apiType]!.replace(/\/$/, "") +
        adapter.upstreamPath(route.upstreamModel, ctx, opts.stream);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: opts.stream ? "text/event-stream" : "application/json",
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
          headersTimeout: opts.stream ? deps.config.streamHeadersTimeoutMs : deps.config.requestTimeoutMs,
          bodyTimeout: deps.config.bodyIdleTimeoutMs,
          signal: opts.signal,
        });
      } catch (err) {
        await sel.release();
        if (opts.signal.aborted) throw new GatewayHttpError("bad_request", "Client closed the request.", { httpStatus: 499 });
        await deps.pool.recordFailure(key, err instanceof Error ? err.name : "network");
        continue;
      }

      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        return { res, key, route, prepared, releaseKey: sel.release, attempts, ttfbMs: deps.now() - opts.startedAt };
      }

      if (status === 429 || status === 401 || status === 403 || status >= 500 || status === 408) {
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
      opts.log.info("upstream rejected request", { httpStatus: status, poolKeyId: key.id });
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
    for (const ev of raw) {
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
