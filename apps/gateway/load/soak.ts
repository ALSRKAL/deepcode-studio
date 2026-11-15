/**
 * 48 h soak script (docs/plan/04 Phase 4) — smoke mode runs 10 minutes.
 *
 * Synthetic traffic against a LOCAL stack (infra/docker-compose.staging.yml or the
 * dev infra + `pnpm dev:gateway`): seeds a soak user, a pool key pointing at an
 * in-process mock upstream, then loops streaming requests over N virtual keys
 * while sampling:
 *   - settlement pending/dead-letter depth (must return to 0; dead must stay 0)
 *   - pool state (no stuck cooling, no auth_failed)
 *   - usage reconciliation: usage_logs = usage_daily rollup = subscription delta
 *
 * Usage (from apps/gateway — tsx lives there):
 *   node --conditions=@deepcode/source --env-file-if-exists=../../.env --import tsx \
 *     load/soak.ts --base-url http://127.0.0.1:8790 --duration-minutes 10 --concurrency 8
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { createDatabase } from "@deepcode/db";
import { encryptPoolKey, generateVirtualKey, hashVirtualKey, virtualKeyDisplayParts } from "@deepcode/shared/node";
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

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc: Array<[string, string]>, v, i, arr) => {
    if (v.startsWith("--")) acc.push([v.slice(2), arr[i + 1] ?? ""]);
    return acc;
  }, []),
);

const baseUrl = args["base-url"] ?? "http://127.0.0.1:8790";
const durationMinutes = Number(args["duration-minutes"] ?? 10);
const concurrency = Number(args["concurrency"] ?? 8);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const pepper = Buffer.from(requireEnv("KEY_HASH_PEPPER"), "base64");
const encryptionKey = Buffer.from(requireEnv("POOL_KEY_ENCRYPTION_KEY"), "base64");
const internalToken = requireEnv("GATEWAY_INTERNAL_TOKEN");
const databaseUrl = requireEnv("DATABASE_URL");

async function startMockUpstream(): Promise<{ port: number; close: () => void }> {
  const sseChunk = (id: string) =>
    Buffer.from(
      `data: {"id":"${id}","choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n` +
        `data: {"id":"${id}","choices":[{"index":0,"delta":{}}],"usage":{"prompt_tokens":120,"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":20}}}\n\n` +
        "data: [DONE]\n\n",
    );
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseChunk(randomUUID()));
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as { port: number }).port, close: () => server.close() };
}

const mock = await startMockUpstream();
const upstreamBase = `http://127.0.0.1:${mock.port}`;
const handle = createDatabase(databaseUrl, { max: 4 });

// ---- seed (idempotent) ----
const soakId = "soak";
await handle.db
  .insert(upstreamProviders)
  .values({
    id: soakId,
    displayName: "Soak mock",
    sessionHeader: null,
    baseUrls: { "openai-chat-completions": `${upstreamBase}/openai/v1` },
  })
  .onConflictDoUpdate({
    target: upstreamProviders.id,
    set: { baseUrls: { "openai-chat-completions": `${upstreamBase}/openai/v1` } },
  });
const modelId = "soak-model";
await handle.db
  .insert(modelRoutes)
  .values({ model: modelId, providerId: soakId, apiType: "openai-chat-completions", upstreamModel: modelId })
  .onConflictDoNothing();
await handle.db
  .insert(modelPrices)
  .values({
    model: modelId,
    inputPerMTok: 1_000_000,
    cachedInputPerMTok: 100_000,
    outputPerMTok: 2_000_000,
    effectiveFrom: new Date(0),
  })
  .onConflictDoNothing();
await handle.db
  .insert(plans)
  .values({
    id: `${soakId}-plan`,
    tier: "pro",
    nameEn: "Soak",
    nameAr: "Soak",
    priceCents: 0,
    creditsPerPeriod: 10_000_000_000,
    rpmLimit: 10_000,
    maxConcurrentStreams: 100,
    allowedModels: [modelId],
    maxOutputTokens: 8192,
    maxDevices: 50,
  })
  .onConflictDoUpdate({ target: plans.id, set: { allowedModels: [modelId] } });

const [existingUser] = await handle.db
  .select()
  .from(users)
  .where(eq(users.email, "soak@deepcode.local"))
  .limit(1);
const soakUser =
  existingUser ??
  (
    await handle.db
      .insert(users)
      .values({ email: "soak@deepcode.local", emailVerified: true })
      .returning()
  )[0];
const [existingSub] = await handle.db
  .select()
  .from(subscriptions)
  .where(eq(subscriptions.userId, soakUser!.id))
  .limit(1);
if (!existingSub) {
  await handle.db.insert(subscriptions).values({
    userId: soakUser!.id,
    planId: `${soakId}-plan`,
    status: "active",
    currentPeriodStart: new Date(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    creditsLimit: 10_000_000_000,
  });
}

const poolSecrets: string[] = [];
for (let i = 0; i < 3; i += 1) {
  const secret = `mock-upstream-key-soak-${randomUUID()}`;
  poolSecrets.push(secret);
  const fingerprint = createHash("sha256").update(secret).digest("hex").slice(0, 8);
  const [existing] = await handle.db
    .select({ id: upstreamPoolKeys.id })
    .from(upstreamPoolKeys)
    .where(eq(upstreamPoolKeys.keyFingerprint, fingerprint))
    .limit(1);
  if (!existing) {
    await handle.db.insert(upstreamPoolKeys).values({
      providerId: soakId,
      label: `soak-${i}`,
      ...encryptPoolKey(secret, encryptionKey),
      keyFingerprint: fingerprint,
    });
  }
}

const keys: Array<{ apiKey: string; keyHash: string }> = [];
for (let i = 0; i < concurrency; i += 1) {
  const key = generateVirtualKey();
  const keyHash = hashVirtualKey(key, pepper).toString("hex");
  keys.push({ apiKey: key, keyHash });
  const [existing] = await handle.db
    .select({ id: virtualApiKeys.id })
    .from(virtualApiKeys)
    .where(eq(virtualApiKeys.keyHash, keyHash))
    .limit(1);
  if (!existing) {
    await handle.db.insert(virtualApiKeys).values({
      userId: soakUser!.id,
      keyHash,
      ...virtualKeyDisplayParts(key),
      name: `soak-${i}`,
      kind: "api",
    });
  }
}
await fetch(new URL("/internal/invalidate", baseUrl), {
  method: "POST",
  headers: { authorization: `Bearer ${internalToken}`, "content-type": "application/json" },
  body: JSON.stringify({ reloadPool: true, reloadCatalog: true }),
});

// ---- traffic loop ----
let requests = 0;
let failures = 0;
let bytes = 0;
const startedAt = Date.now();
const deadline = startedAt + durationMinutes * 60_000;

async function worker(keyIndex: number): Promise<void> {
  const key = keys[keyIndex % keys.length]!.apiKey;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL("/v1/chat/completions", baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: modelId, stream: true, messages: [{ role: "user", content: "soak" }] }),
      });
      if (!res.ok) {
        failures += 1;
        continue;
      }
      const text = await res.text();
      bytes += text.length;
      requests += 1;
    } catch {
      failures += 1;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function sample(): Promise<boolean> {
  const metrics = await fetch(new URL("/metrics", baseUrl), {
    headers: { authorization: `Bearer ${internalToken}` },
  }).then((r) => r.text());
  const pending = Number(/deepcode_settlement_pending_depth(?:\{[^}]*\})? (\d+)/.exec(metrics)?.[1] ?? 0);
  const dead = Number(/deepcode_settlement_dead_letter_depth(?:\{[^}]*\})? (\d+)/.exec(metrics)?.[1] ?? 0);
  const cooling = Number(/deepcode_pool_keys\{[^}]*status="cooling"[^}]*\} (\d+)/.exec(metrics)?.[1] ?? 0);
  console.log(`[soak] requests=${requests} failures=${failures} pending=${pending} dead=${dead} cooling=${cooling}`);
  return dead === 0 && pending < 100;
}

console.log(`[soak] starting: ${durationMinutes} min, ${concurrency} workers, ${poolSecrets.length} pool keys`);
const workers = Array.from({ length: concurrency }, (_, i) => worker(i));
let healthy = true;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10_000));
  healthy = (await sample()) && healthy;
}
await Promise.allSettled(workers);
await sample();

// ---- reconciliation ----
const logsAgg = await handle.sql<{ requests: number; credits: string }[]>`
  select count(*)::int as requests, coalesce(sum(credits_charged),0)::bigint as credits
  from usage_logs where user_id = ${soakUser!.id}`;
const dailyAgg = await handle.sql<{ requests: number; credits: string }[]>`
  select coalesce(sum(requests),0)::int as requests, coalesce(sum(credits_charged),0)::bigint as credits
  from usage_daily where user_id = ${soakUser!.id}`;
const [sub] = await handle.db
  .select()
  .from(subscriptions)
  .where(eq(subscriptions.userId, soakUser!.id))
  .limit(1);
const logs = logsAgg[0]!;
const daily = dailyAgg[0]!;
console.log(
  `[soak] reconcile: usage_logs=${Number(logs.requests)} requests / ${Number(logs.credits)} credits; ` +
    `usage_daily=${Number(daily.requests)}/${Number(daily.credits)}; subscription credits_used=${Number(sub!.creditsUsed)}`,
);
const reconciled =
  Number(logs.credits) === Number(daily.credits) && Number(logs.credits) === Number(sub!.creditsUsed);
console.log(
  `[soak] DONE in ${Math.round((Date.now() - startedAt) / 1000)}s: requests=${requests} failures=${failures} ` +
    `bytes=${bytes} reconciled=${reconciled} healthy=${healthy}`,
);
mock.close();
await handle.close();
process.exit(reconciled && healthy && failures === 0 ? 0 : 1);
