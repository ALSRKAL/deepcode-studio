/**
 * Creates an isolated load-test tenant pointing at load/mock-upstream.ts and writes
 * its virtual key to the file given as the first argument (never to stdout).
 * Usage: node --conditions=@deepcode/source --env-file=../../.env --import tsx load/seed-load.ts <key-file>
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  encryptPoolKey,
  generateVirtualKey,
  hashVirtualKey,
  parseEncryptionKey,
  virtualKeyDisplayParts,
} from "@deepcode/shared/node";
import {
  createDatabase,
  modelPrices,
  modelRoutes,
  plans,
  subscriptions,
  upstreamPoolKeys,
  upstreamProviders,
  users,
  virtualApiKeys,
} from "@deepcode/db";

const keyFile = process.argv[2];
if (!keyFile) throw new Error("usage: seed-load.ts <key-file>");
const mockUrl = process.env.MOCK_URL ?? "http://127.0.0.1:8799";
const { db, close } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
const pepper = Buffer.from(process.env.KEY_HASH_PEPPER!, "base64");
const encryptionKey = parseEncryptionKey(process.env.POOL_KEY_ENCRYPTION_KEY!);

const id = randomUUID().slice(0, 8);
const providerId = `load-${id}`;
const model = `load-model-${id}`;
await db.insert(upstreamProviders).values({
  id: providerId,
  displayName: "load test mock",
  baseUrls: { "openai-chat-completions": `${mockUrl}/openai/v1` },
});
await db.insert(modelRoutes).values({ model, providerId, apiType: "openai-chat-completions", upstreamModel: model });
await db.insert(modelPrices).values({ model, inputPerMTok: 1_000_000, cachedInputPerMTok: 100_000, outputPerMTok: 2_000_000, effectiveFrom: new Date(0) });
const planId = `load-${id}`;
await db.insert(plans).values({
  id: planId,
  tier: "team",
  nameEn: "Load",
  nameAr: "تحميل",
  priceCents: 0,
  creditsPerPeriod: 1_000_000_000_000,
  rpmLimit: 1_000_000,
  maxConcurrentStreams: 10_000,
  allowedModels: [model],
  isPublic: false,
});
const [user] = await db.insert(users).values({ email: `load-${id}@test.local` }).returning();
await db.insert(subscriptions).values({
  userId: user!.id,
  planId,
  status: "active",
  currentPeriodStart: new Date(),
  expiresAt: new Date(Date.now() + 86_400_000),
  creditsLimit: 1_000_000_000_000,
});
const key = generateVirtualKey();
await db.insert(virtualApiKeys).values({
  userId: user!.id,
  keyHash: hashVirtualKey(key, pepper).toString("hex"),
  ...virtualKeyDisplayParts(key),
  name: "load",
});
for (let i = 0; i < 4; i += 1) {
  await db.insert(upstreamPoolKeys).values({
    providerId,
    label: `load-${i}`,
    maxConcurrency: 100,
    ...encryptPoolKey(`mock-upstream-key-load-${id}-${i}`, encryptionKey),
  });
}
writeFileSync(keyFile, JSON.stringify({ key, model }), { mode: 0o600 });
console.log(`load tenant ready: model ${model}, 4 pool keys x 100 concurrency`);
await close();
