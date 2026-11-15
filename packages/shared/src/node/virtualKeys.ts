import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { VIRTUAL_KEY_BODY_LENGTH, VIRTUAL_KEY_PREFIX } from "../constants.js";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_PATTERN = new RegExp(`^${VIRTUAL_KEY_PREFIX}[0-9A-Za-z]{${VIRTUAL_KEY_BODY_LENGTH}}$`);

function toBase62(bytes: Buffer, length: number): string {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(length, "0");
}

/** Generates `sk-dc-` + 43 base62 chars from 32 CSPRNG bytes (256 bits). */
export function generateVirtualKey(): string {
  return VIRTUAL_KEY_PREFIX + toBase62(randomBytes(32), VIRTUAL_KEY_BODY_LENGTH);
}

export function isWellFormedVirtualKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * HMAC-SHA256(pepper, key). Keys carry 256 bits of entropy, so a fast keyed hash
 * is sufficient; a slow password hash would only add latency (docs/plan/02 §4).
 */
export function hashVirtualKey(key: string, pepper: Buffer): Buffer {
  if (pepper.length < 32) throw new Error("KEY_HASH_PEPPER must be at least 32 bytes");
  return createHmac("sha256", pepper).update(key, "utf8").digest();
}

export function hashesEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Display fragments stored alongside the hash; the full key is never stored. */
export function virtualKeyDisplayParts(key: string): { keyPrefix: string; last4: string } {
  return { keyPrefix: key.slice(0, 10), last4: key.slice(-4) };
}
