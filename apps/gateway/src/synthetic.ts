/**
 * Synthetic.new specifics (owner decision 2026-11-16; docs read the same day:
 * https://dev.synthetic.new/docs/api/models, /docs/synthetic/quotas, /docs/synthetic/search).
 *
 * - `fast:` prefix: up to 2x faster, 2x the draw; only some plans may use it.
 * - `infinite:` aliases: never count against the limit, but REQUIRE streaming.
 *   A non-streaming caller still gets a normal JSON response: the gateway streams
 *   upstream and assembles the chunks (aggregateChatCompletionStream).
 * - GET /v2/quotas: free, not rate limited; polled per key for the admin gauges.
 */
import { and, eq } from "drizzle-orm";
import { request, type Dispatcher } from "undici";
import { SYNTHETIC_PROVIDER, upstreamPoolKeys, upstreamProviders, type Database } from "@deepcode/db";
import { encryptPoolKey, poolKeyFingerprint } from "@deepcode/shared/node/pool-crypto";
import type { Logger } from "./logger.js";

export const FAST_PREFIX = "fast:";
export const INFINITE_PREFIX = "infinite:";
export const SYNTHETIC_HOST = "api.synthetic.new";

export const isInfiniteModel = (upstreamModel: string) => upstreamModel.startsWith(INFINITE_PREFIX);

/** Credits draw multiplier for fast mode (Synthetic charges 2x of the rate limit). */
export const FAST_MODE_MULTIPLIER = 2;

/**
 * Origin of a Synthetic provider (quotas/search live at <origin>/v2/...), or null.
 * A provider counts as Synthetic when a base URL is on api.synthetic.new or its id
 * starts with "synthetic" (self-hosted relays and tests).
 */
export function syntheticOrigin(baseUrls: Partial<Record<string, string>>, providerId = ""): string | null {
  const isSyntheticId = providerId === "synthetic" || providerId.startsWith("synthetic-");
  for (const url of Object.values(baseUrls)) {
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.hostname === SYNTHETIC_HOST || isSyntheticId) return u.origin;
    } catch {
      /* ignore malformed */
    }
  }
  return null;
}

/**
 * Builds a standard chat.completion object from an OpenAI Chat Completions SSE body,
 * keeping content, reasoning, tool calls (merged by index), finish reasons and usage.
 */
export function aggregateChatCompletionStream(sse: string): Record<string, unknown> {
  let id = "";
  let model = "";
  let created = 0;
  let usage: unknown = undefined;
  type Choice = {
    index: number;
    content: string;
    reasoning: string;
    reasoningField: "reasoning_content" | "reasoning";
    role: string;
    finish: string | null;
    tools: Map<number, { id?: string; type?: string; function: { name: string; arguments: string } }>;
  };
  const choices = new Map<number, Choice>();
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    id ||= chunk.id ?? "";
    model ||= chunk.model ?? "";
    created ||= chunk.created ?? 0;
    if (chunk.usage) usage = chunk.usage;
    for (const c of chunk.choices ?? []) {
      const index = typeof c.index === "number" ? c.index : 0;
      const choice =
        choices.get(index) ??
        ({ index, content: "", reasoning: "", reasoningField: "reasoning_content", role: "assistant", finish: null, tools: new Map() } as Choice);
      const d = c.delta ?? {};
      if (typeof d.role === "string") choice.role = d.role;
      if (typeof d.content === "string") choice.content += d.content;
      if (typeof d.reasoning_content === "string") choice.reasoning += d.reasoning_content;
      if (typeof d.reasoning === "string") {
        choice.reasoning += d.reasoning;
        choice.reasoningField = "reasoning";
      }
      for (const t of d.tool_calls ?? []) {
        const ti = typeof t.index === "number" ? t.index : choice.tools.size;
        const acc = choice.tools.get(ti) ?? { function: { name: "", arguments: "" } };
        if (t.id) acc.id = t.id;
        if (t.type) acc.type = t.type;
        if (t.function?.name) acc.function.name += t.function.name;
        if (typeof t.function?.arguments === "string") acc.function.arguments += t.function.arguments;
        choice.tools.set(ti, acc);
      }
      if (c.finish_reason) choice.finish = c.finish_reason;
      choices.set(index, choice);
    }
  }
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [...choices.values()]
      .sort((a, b) => a.index - b.index)
      .map((c) => ({
        index: c.index,
        message: {
          role: c.role,
          content: c.content.length > 0 ? c.content : c.tools.size > 0 ? null : "",
          ...(c.reasoning ? { [c.reasoningField]: c.reasoning } : {}),
          ...(c.tools.size > 0
            ? {
                tool_calls: [...c.tools.entries()]
                  .sort(([a], [b]) => a - b)
                  .map(([, t]) => ({ id: t.id ?? "", type: t.type ?? "function", function: t.function })),
              }
            : {}),
        },
        finish_reason: c.finish ?? "stop",
      })),
    ...(usage !== undefined ? { usage } : {}),
  };
}

export interface QuotaReading {
  remainingPct: number | null;
  renewsAt: Date | null;
  limit: number | null;
  used: number | null;
}

/**
 * Parses GET /v2/quotas. The documented shape is
 * { subscription: { limit, requests, renewsAt } }; an account without a
 * subscription answers {} (seen 2026-11-16), which reads as "no limit known".
 */
export function parseSyntheticQuota(body: unknown): QuotaReading {
  const sub = (body as { subscription?: Record<string, unknown> } | null)?.subscription;
  const limit = typeof sub?.limit === "number" ? sub.limit : null;
  const used = typeof sub?.requests === "number" ? sub.requests : null;
  const renews = typeof sub?.renewsAt === "string" ? new Date(sub.renewsAt) : null;
  const remainingPct =
    limit !== null && limit > 0 && used !== null ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100))) : null;
  return { remainingPct, renewsAt: renews && !Number.isNaN(renews.getTime()) ? renews : null, limit, used };
}

/** Alert when a key is below 20% or renews within 72 hours. */
export function quotaAlert(q: QuotaReading, now: number): "low" | "renewing" | null {
  if (q.remainingPct !== null && q.remainingPct < 20) return "low";
  if (q.renewsAt && q.renewsAt.getTime() - now < 72 * 3600_000 && q.renewsAt.getTime() > now) return "renewing";
  return null;
}

export interface QuotaPollerDeps {
  db: Database;
  agent: Dispatcher;
  /** Plaintext key for a pool key id (decrypted in the gateway only). */
  revealKey: (poolKeyId: string) => string | null;
  log: Logger;
  now: () => number;
  /** Optional sink for alerts (e.g. the web app's admin notification hook). */
  onAlert?: (alert: { poolKeyId: string; label: string; kind: "low" | "renewing"; reading: QuotaReading }) => Promise<void>;
}

/** Polls /v2/quotas for every active key of every Synthetic provider and stores the reading. */
export async function pollSyntheticQuotas(deps: QuotaPollerDeps): Promise<number> {
  const providers = await deps.db.select().from(upstreamProviders).where(eq(upstreamProviders.enabled, true));
  let polled = 0;
  for (const p of providers) {
    const origin = syntheticOrigin(p.baseUrls as Record<string, string>, p.id);
    if (!origin) continue;
    const keys = await deps.db
      .select()
      .from(upstreamPoolKeys)
      .where(and(eq(upstreamPoolKeys.providerId, p.id), eq(upstreamPoolKeys.status, "active")));
    for (const k of keys) {
      const secret = deps.revealKey(k.id);
      if (!secret) continue;
      try {
        const res = await request(`${origin}/v2/quotas`, {
          method: "GET",
          headers: { authorization: `Bearer ${secret}`, accept: "application/json", "user-agent": "deepcode-gateway/1.0" },
          dispatcher: deps.agent,
          headersTimeout: 15_000,
          bodyTimeout: 15_000,
        });
        const text = await res.body.text();
        if (res.statusCode !== 200) {
          deps.log.warn("synthetic quota poll failed", { poolKeyId: k.id, httpStatus: res.statusCode });
          continue;
        }
        const raw = JSON.parse(text) as Record<string, unknown>;
        const reading = parseSyntheticQuota(raw);
        await deps.db
          .update(upstreamPoolKeys)
          .set({
            quotaRaw: raw,
            quotaRemainingPct: reading.remainingPct,
            quotaRenewsAt: reading.renewsAt,
            quotaCheckedAt: new Date(deps.now()),
          })
          .where(eq(upstreamPoolKeys.id, k.id));
        polled += 1;
        const alert = quotaAlert(reading, deps.now());
        if (alert) {
          deps.log.warn("synthetic quota alert", { poolKeyId: k.id, kind: alert, remainingPct: reading.remainingPct });
          await deps.onAlert?.({ poolKeyId: k.id, label: k.label, kind: alert, reading }).catch(() => {});
        }
      } catch (err) {
        deps.log.warn("synthetic quota poll error", { poolKeyId: k.id, err: err instanceof Error ? err.name : "error" });
      }
    }
  }
  return polled;
}

/**
 * `SYNTHETIC_API_KEYS="syn_a,syn_b"` → pool keys, on every gateway start. Creates the
 * Synthetic provider if it is missing; adds only keys whose fingerprint is not in the
 * pool yet (so admin changes — disabling a key, weights — are never overwritten).
 * Returns the number of keys added.
 */
export async function seedSyntheticKeysFromEnv(deps: {
  db: Database;
  encryptionKey: Buffer;
  raw: string | undefined;
  log: Logger;
}): Promise<number> {
  const keys = (deps.raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length >= 8);
  if (keys.length === 0) return 0;
  await deps.db
    .insert(upstreamProviders)
    .values({
      id: SYNTHETIC_PROVIDER.id,
      displayName: SYNTHETIC_PROVIDER.displayName,
      baseUrls: SYNTHETIC_PROVIDER.baseUrls,
      sessionHeader: SYNTHETIC_PROVIDER.sessionHeader,
      catalogFormat: SYNTHETIC_PROVIDER.catalogFormat,
      modelsUrl: SYNTHETIC_PROVIDER.modelsUrl,
      enabled: true,
      priority: 1,
    })
    .onConflictDoNothing();
  const existing = new Set(
    (await deps.db.select({ fp: upstreamPoolKeys.keyFingerprint }).from(upstreamPoolKeys)).map((r) => r.fp),
  );
  let added = 0;
  for (const [i, key] of keys.entries()) {
    const fingerprint = poolKeyFingerprint(key);
    if (existing.has(fingerprint)) continue;
    await deps.db.insert(upstreamPoolKeys).values({
      providerId: SYNTHETIC_PROVIDER.id,
      label: `Synthetic (env #${i + 1})`,
      ...encryptPoolKey(key, deps.encryptionKey),
      keyFingerprint: fingerprint,
      weight: 1,
      maxConcurrency: 8,
    });
    existing.add(fingerprint);
    added += 1;
  }
  if (added > 0) deps.log.info("synthetic keys added from environment", { added });
  return added;
}
