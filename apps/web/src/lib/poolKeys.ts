import { encryptPoolKey, parseEncryptionKey, poolKeyFingerprint } from "@deepcode/shared/node/pool-crypto";
import { upstreamPoolKeys, type Database } from "@deepcode/db";
import { env } from "./env";

/**
 * Pool-key handling in the web app is WRITE-ONLY (docs/plan/04 §3.1): this module
 * imports only the encryption half of @deepcode/shared — no decrypt function is
 * reachable from apps/web (enforced by the .oxlintrc.json import ban), and no API
 * response or page ever includes ciphertext or plaintext, only the fingerprint.
 */
export interface NewPoolKey {
  providerId: string;
  label: string;
  /** The plaintext upstream key; used once to encrypt, never stored or echoed. */
  plaintext: string;
  weight?: number;
  maxConcurrency?: number;
  supportedModels?: string[] | null;
  notes?: string;
}

export async function insertPoolKey(db: Database, key: NewPoolKey) {
  const encryptionKey = parseEncryptionKey(env.POOL_KEY_ENCRYPTION_KEY);
  const [row] = await db
    .insert(upstreamPoolKeys)
    .values({
      providerId: key.providerId,
      label: key.label,
      ...encryptPoolKey(key.plaintext, encryptionKey),
      keyFingerprint: poolKeyFingerprint(key.plaintext),
      weight: key.weight ?? 1,
      maxConcurrency: key.maxConcurrency ?? 8,
      supportedModels: key.supportedModels ?? null,
      notes: key.notes ?? null,
    })
    .returning({ id: upstreamPoolKeys.id, keyFingerprint: upstreamPoolKeys.keyFingerprint });
  return row!;
}
