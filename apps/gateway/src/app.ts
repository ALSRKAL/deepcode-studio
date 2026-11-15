import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Redis } from "ioredis";
import { Agent } from "undici";
import { sql } from "drizzle-orm";
import {
  daysLeft,
  InvalidateRequestSchema,
  percentUsed,
  USAGE_HEADERS,
  uuidv7,
  type SubscriptionStatusResponse,
} from "@deepcode/shared";
import { createDatabase, type DatabaseHandle } from "@deepcode/db";
import { Authenticator, lockReason, renewUrl } from "./auth.js";
import { Catalog } from "./catalog.js";
import type { GatewayConfig } from "./config.js";
import { errorResponse, GatewayHttpError } from "./errors.js";
import { clientIp, rateHeaders, usageHeaders } from "./http.js";
import { Limits } from "./limits.js";
import { createLogger, SecretRegistry, type LogSink, type Logger } from "./logger.js";
import { Settlement } from "./metering.js";
import { Metrics } from "./metrics.js";
import type { Database } from "@deepcode/db";
import { PoolManager } from "./pool.js";
import { ADAPTERS } from "./protocols/index.js";
import { handleProxy, type ProxyDeps } from "./proxy.js";
import { RedisScripts } from "./redisScripts.js";
import { SyncService } from "./sync.js";

const RELOAD_CHANNEL = "deepcode:reload";
const EXPOSED_HEADERS = [...Object.values(USAGE_HEADERS), "Retry-After"];

export interface Gateway {
  app: Hono;
  deps: ProxyDeps & { db: Database; redis: Redis; handle: DatabaseHandle };
  /** Load pool and catalog, start background timers and the reload subscriber. */
  start(): Promise<void>;
  close(): Promise<void>;
  /** Prometheus text exposition (docs/plan/02 §9); scrape-time collection. */
  metricsText(): Promise<string>;
}

export function createGateway(
  config: GatewayConfig,
  options: { logSink?: LogSink; now?: () => number; dbMax?: number } = {},
): Gateway {
  const now = options.now ?? Date.now;
  const secrets = new SecretRegistry();
  const logger = createLogger({ level: config.logLevel, secrets, ...(options.logSink ? { sink: options.logSink } : {}) });
  const handle = createDatabase(config.databaseUrl, { max: options.dbMax ?? 20 });
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableAutoPipelining: true });
  const subscriber = redis.duplicate();
  const scripts = new RedisScripts(redis);
  const agent = new Agent({ keepAliveTimeout: 30_000, connections: 256 });

  const deps: Gateway["deps"] = {
    config,
    db: handle.db,
    handle,
    redis,
    auth: new Authenticator({ db: handle.db, redis, scripts, pepper: config.pepper, snapshotTtlSec: config.snapshotTtlSec, now }),
    limits: new Limits({ redis, scripts, now }),
    pool: new PoolManager({ db: handle.db, redis, scripts, encryptionKey: config.encryptionKey, secrets, logger, now }),
    catalog: new Catalog(handle.db),
    sync: new SyncService({ db: handle.db, webUrl: () => config.webOrigin, now }),
    settlement: new Settlement({ db: handle.db, redis, logger, now }),
    logger,
    secrets,
    agent,
    now,
    streams: { active: 0 },
  };
  const metrics = new Metrics({ config, db: handle.db, redis, pool: deps.pool, settlement: deps.settlement, streams: deps.streams, now });

  const app = buildApp(deps, metrics, logger);
  const timers: NodeJS.Timeout[] = [];

  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    const t = setInterval(() => {
      fn().catch((err) => logger.error(`${name} failed`, { err }));
    }, ms);
    t.unref();
    timers.push(t);
  };

  return {
    app,
    deps,
    metricsText: () => metrics.render(),
    async start() {
      await Promise.all([deps.pool.reload(), deps.catalog.reload(new Date(now()))]);
      await handle.db.execute(sql`select ensure_usage_log_partitions(2)`);
      every(config.poolReloadIntervalMs, "pool reload", () => deps.pool.reload());
      every(config.catalogReloadIntervalMs, "catalog reload", () => deps.catalog.reload(new Date(now())));
      every(60_000, "pool stats flush", () => deps.pool.flushStats());
      every(5_000, "settlement drain", () => deps.settlement.drain());
      every(6 * 3_600_000, "partition maintenance", () => handle.db.execute(sql`select ensure_usage_log_partitions(2)`));
      await subscriber.subscribe(RELOAD_CHANNEL);
      subscriber.on("message", (_channel, message: string) => {
        const task = message === "pool" ? deps.pool.reload() : message === "catalog" ? deps.catalog.reload(new Date(now())) : null;
        task?.catch((err) => logger.error("reload failed", { err, message }));
      });
      logger.info("gateway started", { poolKeys: deps.pool.size() });
    },
    async close() {
      for (const t of timers) clearInterval(t);
      await deps.settlement.close();
      subscriber.disconnect();
      await agent.close().catch(() => {});
      redis.disconnect();
      await handle.close();
    },
  };
}

function buildApp(deps: Gateway["deps"], metrics: Metrics, logger: Logger): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: "*", exposeHeaders: EXPOSED_HEADERS, maxAge: 600 }));

  // Prometheus instrumentation: one record per response, low-cardinality route
  // label. Handlers throw through this middleware to app.onError, so errors are
  // classified here too — the alert-worthy classes (429, 5xx) are mostly throws.
  app.use("*", async (c, next) => {
    const start = deps.now();
    try {
      await next();
    } finally {
      const route = metrics.routeLabel(new URL(c.req.url).pathname);
      const status = c.error
        ? c.error instanceof GatewayHttpError
          ? c.error.status
          : 500
        : (c.res?.status ?? 500);
      metrics.observe(route, status, deps.now() - start);
    }
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    try {
      await deps.handle.sql`select 1`;
      await deps.redis.ping();
      return c.json({ ok: true, poolKeys: deps.pool.size() });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.post("/v1/chat/completions", (c) => handleProxy(c, ADAPTERS["openai-chat-completions"], deps));
  app.post("/v1/messages", (c) => handleProxy(c, ADAPTERS["anthropic-messages"], deps));
  app.post("/v1/responses", (c) => handleProxy(c, ADAPTERS["openai-responses"], deps));
  app.post("/v1beta/models/:modelAction", (c) => {
    const action = c.req.param("modelAction");
    const sep = action.lastIndexOf(":");
    const model = sep > 0 ? action.slice(0, sep) : action;
    const method = sep > 0 ? action.slice(sep + 1) : "";
    if (method !== "generateContent" && method !== "streamGenerateContent") {
      return errorResponse(new GatewayHttpError("bad_request", "Unsupported method."), uuidv7(deps.now()));
    }
    return handleProxy(c, ADAPTERS["google-generative-ai"], deps, { model, method });
  });

  app.get("/v1/models", async (c) => {
    const requestId = uuidv7(deps.now());
    try {
      const snapshot = await deps.auth.authenticate(c.req.raw, clientIp(c, deps.config.trustProxy));
      const allowed = snapshot.subscription?.plan.allowedModels ?? [];
      return c.json({
        object: "list",
        // OpenAI list shape plus DeepCode fields (ignored by plain OpenAI clients):
        // name, description, limits, capabilities, the native API, free flag, badge.
        data: allowed
          .filter((m) => deps.catalog.isServable(m))
          .map((id) => {
            const info = deps.catalog.info(id);
            return {
              id,
              object: "model",
              created: 0,
              owned_by: "deepcode",
              name: info?.name ?? id,
              description: info?.description ?? null,
              context_window: info?.contextWindow ?? null,
              max_output_tokens: info?.maxOutputTokens ?? null,
              input_modalities: info?.inputModalities ?? [],
              capabilities: info?.capabilities ?? {},
              api_type: deps.catalog.routes(id)[0]?.apiType ?? null,
              free: info?.free ?? false,
              badge: info?.badge ?? null,
              sort_order: info?.sortOrder ?? 100,
            };
          })
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      });
    } catch (err) {
      return toErrorResponse(err, requestId, logger);
    }
  });

  // Skills/MCP sync manifest (docs/plan/01 §8.2): device-key auth, tier filter,
  // If-None-Match on the revision. The reload channel busts the cached revision.
  app.get("/v1/sync/manifest", async (c) => {
    const requestId = uuidv7(deps.now());
    try {
      const snapshot = await deps.auth.authenticate(c.req.raw, clientIp(c, deps.config.trustProxy));
      const rate = await deps.limits.rpm(`sync:${snapshot.keyId}`, 30, requestId);
      if (!rate.allowed) throw new GatewayHttpError("rate_limited", undefined, { retryAfterSec: rate.resetMs / 1000 });
      const ifNoneMatch = c.req.header("if-none-match");
      const revision = await deps.sync.revision();
      if (ifNoneMatch === `rev:${revision}`) {
        return new Response(null, { status: 304, headers: { ETag: `rev:${revision}`, "cache-control": "no-store" } });
      }
      const result = await deps.sync.manifestFor(snapshot);
      if ("status" in result) {
        return errorResponse(new GatewayHttpError("internal", undefined, { httpStatus: result.status }), requestId);
      }
      return c.json(result.manifest, 200, {
        "cache-control": "no-store",
        ETag: `rev:${revision}`,
        [USAGE_HEADERS.requestId]: requestId,
      });
    } catch (err) {
      return toErrorResponse(err, requestId, logger);
    }
  });

  app.get("/v1/subscription/status", async (c) => {    const requestId = uuidv7(deps.now());
    let rate = null;
    try {
      const snapshot = await deps.auth.authenticate(c.req.raw, clientIp(c, deps.config.trustProxy));
      rate = await deps.limits.rpm(`status:${snapshot.keyId}`, 30, requestId);
      if (!rate.allowed) throw new GatewayHttpError("rate_limited", undefined, { retryAfterSec: rate.resetMs / 1000 });
      const now = deps.now();
      const sub = snapshot.subscription;
      const reason = lockReason(snapshot, now);
      const body: SubscriptionStatusResponse = sub
        ? {
            plan: { id: sub.plan.id, tier: sub.plan.tier, name: { en: sub.plan.nameEn, ar: sub.plan.nameAr } },
            status: sub.status,
            credits: {
              limit: sub.creditsLimit,
              used: sub.creditsUsed,
              remaining: Math.max(0, sub.creditsLimit - sub.creditsUsed),
              percentUsed: percentUsed(sub.creditsUsed, sub.creditsLimit),
            },
            period: {
              startsAt: new Date(sub.currentPeriodStart).toISOString(),
              expiresAt: new Date(sub.expiresAt).toISOString(),
              daysLeft: daysLeft(new Date(sub.expiresAt), new Date(now)),
            },
            limits: {
              rpm: sub.plan.rpmLimit,
              allowedModels: sub.plan.allowedModels.filter((m) => deps.catalog.isServable(m)),
            },
            lock: reason ? { reason, renewUrl: renewUrl(deps.config.webOrigin, reason) } : null,
            serverTime: new Date(now).toISOString(),
          }
        : {
            plan: { id: "none", tier: "free", name: { en: "No plan", ar: "لا توجد خطة" } },
            status: "expired",
            credits: { limit: 0, used: 0, remaining: 0, percentUsed: 100 },
            period: { startsAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString(), daysLeft: 0 },
            limits: { rpm: 0, allowedModels: [] },
            lock: { reason: "expired", renewUrl: renewUrl(deps.config.webOrigin, "expired") },
            serverTime: new Date(now).toISOString(),
          };
      return c.json(body, 200, {
        "cache-control": "no-store",
        [USAGE_HEADERS.requestId]: requestId,
        ...usageHeaders(sub),
        ...rateHeaders(rate),
      });
    } catch (err) {
      return toErrorResponse(err, requestId, logger, rateHeaders(rate));
    }
  });

  app.post("/internal/invalidate", async (c) => {    const requestId = uuidv7(deps.now());
    const given = Buffer.from(c.req.header("authorization")?.replace(/^Bearer /i, "") ?? "");
    const expected = Buffer.from(deps.config.internalToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return errorResponse(new GatewayHttpError("invalid_api_key"), requestId);
    }
    const parsed = InvalidateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse(new GatewayHttpError("bad_request"), requestId);
    const removed = await deps.auth.invalidate({
      ...(parsed.data.keyHashes ? { keyHashes: parsed.data.keyHashes } : {}),
      ...(parsed.data.userIds ? { userIds: parsed.data.userIds } : {}),
    });
    if (parsed.data.reloadPool) await deps.redis.publish(RELOAD_CHANNEL, "pool");
    if (parsed.data.reloadCatalog) await deps.redis.publish(RELOAD_CHANNEL, "catalog");
    deps.sync.invalidate();
    return c.json({ ok: true, invalidated: removed });
  });

  // Metrics are scrape-ready Prometheus text. On the main port the internal token is
  // required; server.ts also serves them unauthenticated on GATEWAY_METRICS_PORT when
  // it is set, which deployments bind to the private network only.
  app.on(["GET", "POST", "PUT", "DELETE", "PATCH"], "/metrics", async (c) => {
    if (c.req.method !== "GET") {
      return errorResponse(new GatewayHttpError("bad_request", "Method not allowed.", { httpStatus: 405 }), uuidv7(deps.now()));
    }
    const requestId = uuidv7(deps.now());
    const given = Buffer.from(c.req.header("authorization")?.replace(/^Bearer /i, "") ?? "");
    const expected = Buffer.from(deps.config.internalToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return errorResponse(new GatewayHttpError("invalid_api_key", "Metrics require the internal token.", { httpStatus: 401 }), requestId);
    }
    return new Response(await metrics.render(), {
      status: 200,
      headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  });

  app.notFound(() => errorResponse(new GatewayHttpError("bad_request", "Unknown route.", { httpStatus: 404 }), uuidv7(deps.now())));
  app.onError((err) => toErrorResponse(err, uuidv7(deps.now()), logger));

  return app;
}

function toErrorResponse(err: unknown, requestId: string, logger: Logger, headers: Record<string, string> = {}): Response {
  if (err instanceof GatewayHttpError) return errorResponse(err, requestId, headers);
  logger.error("unhandled error", { requestId, err });
  return errorResponse(new GatewayHttpError("internal"), requestId, headers);
}
