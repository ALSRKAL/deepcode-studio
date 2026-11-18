import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { inject } from "vitest";
import { STREAM_USAGE_COMMENT_PREFIX, type StreamUsageNotice } from "@deepcode/shared";
import {
  encryptPoolKey,
  generateVirtualKey,
  hashVirtualKey,
  virtualKeyDisplayParts,
} from "@deepcode/shared/node";
import {
  modelPrices,
  modelRoutes,
  plans,
  subscriptions,
  upstreamPoolKeys,
  upstreamProviders,
  users,
  virtualApiKeys,
} from "@deepcode/db";
import { createGateway, type Gateway } from "../../src/app.js";
import type { GatewayConfig } from "../../src/config.js";
import { MockUpstream } from "./mockUpstream.js";

/** $1 / $0.10 / $2 per MTok -> the shared fixture usage (120 in, 20 cached, 30 out) costs 162 credits. */
export const TEST_PRICE = { inputPerMTok: 1_000_000, cachedInputPerMTok: 100_000, outputPerMTok: 2_000_000 };
export const EXPECTED_CREDITS = 162;

export interface Harness {
  gw: Gateway;
  mock: MockUpstream;
  logs: string[];
  config: GatewayConfig;
  close(): Promise<void>;
}

export async function startHarness(overrides: Partial<GatewayConfig> = {}): Promise<Harness> {
  const mock = new MockUpstream();
  await mock.start();
  const logs: string[] = [];
  const config: GatewayConfig = {
    databaseUrl: inject("databaseUrl"),
    redisUrl: inject("redisUrl"),
    encryptionKey: randomBytes(32),
    pepper: randomBytes(32),
    internalToken: randomBytes(32).toString("hex"),
    port: 0,
    metricsPort: null,
    metricsHost: "127.0.0.1",
    webOrigin: "https://deepcode.test",
    streamHeadersTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
    bodyIdleTimeoutMs: 10_000,
    maxRequestBodyBytes: 1024 * 1024,
    maxRequestBodyHardBytes: 3 * 1024 * 1024,
    trustProxy: true,
    logLevel: "debug",
    maxAttempts: 3,
    settleWaitMs: 1_500,
    poolReloadIntervalMs: 15_000,
    catalogReloadIntervalMs: 60_000,
    quotaPollIntervalMs: 900_000,
    quotaAlertWebhookUrl: null,
    fastModeTiers: ["team"],
    snapshotTtlSec: 30,
    ...overrides,
  };
  const gw = createGateway(config, { logSink: (l) => logs.push(l), dbMax: 30 });
  await gw.start();
  return {
    gw,
    mock,
    logs,
    config,
    async close() {
      await gw.close();
      await mock.close();
    },
  };
}

export interface TenantOptions {
  keys?: Array<{ weight?: number; maxConcurrency?: number; supportedModels?: (models: string[]) => string[] }>;
  plan?: Partial<typeof plans.$inferInsert>;
  subscription?: Partial<typeof subscriptions.$inferInsert>;
  fallbackKeys?: number;
  /** Upstream model id per tenant model (default `${model}-upstream`). */
  upstreamModel?: (model: string) => string;
  /** Provider id prefix (e.g. "synthetic" to enable Synthetic-only features). */
  providerPrefix?: string;
  user?: Partial<typeof users.$inferInsert>;
}

export interface Tenant {
  apiKey: string;
  keyHash: string;
  keyId: string;
  userId: string;
  subscriptionId: string;
  planId: string;
  providerId: string;
  models: [string, string];
  poolSecrets: string[];
  poolKeyIds: string[];
  fallbackSecrets: string[];
  ip: string;
}

/**
 * Creates an isolated world per test: its own provider, models, plan, user,
 * subscription, virtual key and pool keys. Nothing is shared between tenants.
 */
export async function createTenant(h: Harness, opts: TenantOptions = {}): Promise<Tenant> {
  const db = h.gw.deps.db;
  const id = randomUUID().slice(0, 8);
  const providerId = `${opts.providerPrefix ?? "p"}-${id}`;
  const models: [string, string] = [`m-${id}-a`, `m-${id}-b`];
  const base = h.mock.url;
  const baseUrls = {
    "openai-chat-completions": `${base}/openai/v1`,
    "openai-responses": `${base}/openai/v1`,
    "anthropic-messages": `${base}/anthropic/v1`,
    "google-generative-ai": `${base}/google/v1beta`,
  };
  await db.insert(upstreamProviders).values({ id: providerId, displayName: providerId, baseUrls, sessionHeader: "x-opencode-session" });
  for (const m of models) {
    await db.insert(modelRoutes).values({ model: m, providerId, apiType: "openai-chat-completions", upstreamModel: opts.upstreamModel?.(m) ?? `${m}-upstream` });
    await db.insert(modelPrices).values({ model: m, ...TEST_PRICE, effectiveFrom: new Date(0) });
  }

  const fallbackSecrets: string[] = [];
  if (opts.fallbackKeys) {
    const fbId = `fb-${id}`;
    await db.insert(upstreamProviders).values({ id: fbId, displayName: fbId, baseUrls, isFallback: true });
    for (const m of models) {
      await db.insert(modelRoutes).values({ model: m, providerId: fbId, apiType: "openai-chat-completions", upstreamModel: `${m}-fallback` });
    }
    for (let i = 0; i < opts.fallbackKeys; i += 1) {
      const secret = `mock-upstream-key-fb-${randomUUID()}`;
      fallbackSecrets.push(secret);
      await db.insert(upstreamPoolKeys).values({ providerId: fbId, label: `fb-${i}`, ...encryptPoolKey(secret, h.config.encryptionKey) });
    }
  }

  const planId = `plan-${id}`;
  await db.insert(plans).values({
    id: planId,
    tier: "pro",
    nameEn: "Pro",
    nameAr: "احترافي",
    priceCents: 3000,
    creditsPerPeriod: 1_000_000_000,
    rpmLimit: 1000,
    maxConcurrentStreams: 100,
    allowedModels: models,
    ...opts.plan,
  });
  const [user] = await db
    .insert(users)
    .values({ email: `u-${id}@test.local`, ...opts.user })
    .returning();
  const now = Date.now();
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId: user!.id,
      planId,
      status: "active",
      currentPeriodStart: new Date(now - 86_400_000),
      expiresAt: new Date(now + 30 * 86_400_000),
      creditsLimit: 1_000_000_000,
      ...opts.subscription,
    })
    .returning();

  const apiKey = generateVirtualKey();
  const keyHash = hashVirtualKey(apiKey, h.config.pepper).toString("hex");
  const [key] = await db
    .insert(virtualApiKeys)
    .values({ userId: user!.id, keyHash, ...virtualKeyDisplayParts(apiKey), name: "test" })
    .returning();

  const poolSecrets: string[] = [];
  const poolKeyIds: string[] = [];
  for (const [i, k] of (opts.keys ?? [{}]).entries()) {
    const secret = `mock-upstream-key-${randomUUID()}`;
    poolSecrets.push(secret);
    const [row] = await db
      .insert(upstreamPoolKeys)
      .values({
        providerId,
        label: `k-${i}`,
        weight: k.weight ?? 1,
        maxConcurrency: k.maxConcurrency ?? 8,
        supportedModels: k.supportedModels ? k.supportedModels(models) : null,
        ...encryptPoolKey(secret, h.config.encryptionKey),
      })
      .returning();
    poolKeyIds.push(row!.id);
  }

  await h.gw.deps.pool.reload();
  await h.gw.deps.catalog.reload();
  return {
    apiKey,
    keyHash,
    keyId: key!.id,
    userId: user!.id,
    subscriptionId: sub!.id,
    planId,
    providerId,
    models,
    poolSecrets,
    poolKeyIds,
    fallbackSecrets,
    ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
}

export type Proto = "chat" | "anthropic" | "responses" | "google";

/** Builds a request in the given protocol, the way an SDK would send it. */
export function call(
  h: Harness,
  t: Tenant,
  proto: Proto,
  opts: { stream?: boolean; model?: string; body?: Record<string, unknown>; key?: string | null; headers?: Record<string, string> } = {},
): Promise<Response> {
  const model = opts.model ?? t.models[0];
  const stream = opts.stream ?? true;
  const key = opts.key === undefined ? t.apiKey : opts.key;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": t.ip, ...opts.headers };
  let path: string;
  let body: Record<string, unknown>;
  switch (proto) {
    case "chat":
      path = "/v1/chat/completions";
      body = { model, stream, messages: [{ role: "user", content: "hi" }], ...opts.body };
      if (key) headers.authorization = `Bearer ${key}`;
      break;
    case "anthropic":
      path = "/v1/messages";
      body = { model, stream, max_tokens: 1000, messages: [{ role: "user", content: "hi" }], ...opts.body };
      if (key) headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      break;
    case "responses":
      path = "/v1/responses";
      body = { model, stream, input: "hi", ...opts.body };
      if (key) headers.authorization = `Bearer ${key}`;
      break;
    case "google":
      path = `/v1beta/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      body = { contents: [{ role: "user", parts: [{ text: "hi" }] }], ...opts.body };
      if (key) headers["x-goog-api-key"] = key;
      break;
  }
  return Promise.resolve(h.gw.app.request(path, { method: "POST", headers, body: JSON.stringify(body) }));
}

export function splitNotice(text: string): { content: string; notice: StreamUsageNotice | null } {
  const lines = text.split("\n\n");
  const idx = lines.findIndex((l) => l.startsWith(STREAM_USAGE_COMMENT_PREFIX));
  if (idx === -1) return { content: text, notice: null };
  const notice = JSON.parse(lines[idx]!.slice(STREAM_USAGE_COMMENT_PREFIX.length)) as StreamUsageNotice;
  lines.splice(idx, 1);
  return { content: lines.join("\n\n"), notice };
}

export async function balance(h: Harness, subscriptionId: string) {
  const [row] = await h.gw.deps.db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  return row!;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
