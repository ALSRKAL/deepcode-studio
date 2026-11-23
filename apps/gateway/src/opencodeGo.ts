import { eq } from "drizzle-orm";
import { OPENCODE_GO_PROVIDER, upstreamPoolKeys, upstreamProviders, type Database } from "@deepcode/db";
import { encryptPoolKey, poolKeyFingerprint } from "@deepcode/shared/node/pool-crypto";
import type { Logger } from "./logger.js";

/**
 * `OPENCODE_GO_API_KEYS="oc_sk_a,oc_sk_b"` → pool keys, on every gateway start.
 *
 * Mirrors the Synthetic bootstrap: the provider row is created if missing (enabled),
 * and only keys whose fingerprint is not in the pool yet are added, so admin changes
 * (weights, disabling a key) are never overwritten. When at least one new key is
 * added the provider is enabled — an env key is an explicit request to use Go.
 */
export async function seedOpencodeGoKeysFromEnv(deps: {
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
      id: OPENCODE_GO_PROVIDER.id,
      displayName: OPENCODE_GO_PROVIDER.displayName,
      baseUrls: OPENCODE_GO_PROVIDER.baseUrls,
      sessionHeader: OPENCODE_GO_PROVIDER.sessionHeader,
      catalogFormat: OPENCODE_GO_PROVIDER.catalogFormat,
      modelsUrl: OPENCODE_GO_PROVIDER.modelsUrl,
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
      providerId: OPENCODE_GO_PROVIDER.id,
      label: `OpenCode Go (env #${i + 1})`,
      ...encryptPoolKey(key, deps.encryptionKey),
      keyFingerprint: fingerprint,
      weight: 1,
      maxConcurrency: 8,
    });
    existing.add(fingerprint);
    added += 1;
  }
  if (added > 0) {
    await deps.db.update(upstreamProviders).set({ enabled: true }).where(eq(upstreamProviders.id, OPENCODE_GO_PROVIDER.id));
    deps.log.info("opencode go keys added from environment", { added });
  }
  return added;
}
