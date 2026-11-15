import { createCipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption side only. Decryption deliberately lives in apps/gateway and nowhere
 * else, so the web app has no code path that can turn ciphertext back into an
 * upstream key (docs/plan/04 §3.1).
 *
 * Format: AES-256-GCM, 12-byte random nonce, ciphertext || 16-byte auth tag.
 * `keyVersion` lets the encryption key be rotated by re-encrypting rows.
 */
export interface EncryptedPoolKey {
  keyCiphertext: Buffer;
  keyNonce: Buffer;
  keyVersion: number;
  keyFingerprint: string;
}

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("POOL_KEY_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** First 8 hex chars of SHA-256: enough to tell keys apart in the admin UI, useless to an attacker. */
export function poolKeyFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 8);
}

export function encryptPoolKey(
  plaintext: string,
  encryptionKey: Buffer,
  keyVersion = 1,
): EncryptedPoolKey {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    keyCiphertext: Buffer.concat([body, cipher.getAuthTag()]),
    keyNonce: nonce,
    keyVersion,
    keyFingerprint: poolKeyFingerprint(plaintext),
  };
}
