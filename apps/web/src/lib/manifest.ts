import { createHash, createPrivateKey, createPublicKey, sign, verify as verifySig } from "node:crypto";
import { env } from "./env";
import type { SyncManifest } from "@deepcode/shared";

/**
 * Skills/MCP sync manifest signing (docs/plan/01 §8.2, doc 03 §6.4). The manifest
 * can deliver instructions to every installed client, so its private key lives in
 * the web environment only (KMS or an offline signing step in production — recorded
 * as an owner item). The signature covers the canonical JSON of the payload.
 */
export function signingKeyPair(): { keyId: string; publicKeyBase64: string } | null {
  if (!env.MANIFEST_SIGNING_KEY) return null;
  const privateKey = createPrivateKey(Buffer.from(env.MANIFEST_SIGNING_KEY, "base64"));
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return { keyId: env.MANIFEST_KEY_ID, publicKeyBase64: publicKey.toString("base64") };
}

export function signManifest(manifest: SyncManifest): string | null {
  if (!env.MANIFEST_SIGNING_KEY) return null;
  const privateKey = createPrivateKey(Buffer.from(env.MANIFEST_SIGNING_KEY, "base64"));
  return sign(null, Buffer.from(canonicalJson(manifest), "utf8"), privateKey).toString("base64");
}

/** Signs an arbitrary JSON-able item (per-item marketplace signatures). */
export function signPayload(value: unknown): string | null {
  if (!env.MANIFEST_SIGNING_KEY) return null;
  const privateKey = createPrivateKey(Buffer.from(env.MANIFEST_SIGNING_KEY, "base64"));
  return sign(null, Buffer.from(canonicalJson(value), "utf8"), privateKey).toString("base64");
}

/** Verification helper (used by tests; the desktop keeps its own public key). */
export function verifyManifest(manifest: SyncManifest, signatureBase64: string, publicKeyBase64: string): boolean {
  return verifySig(
    null,
    Buffer.from(canonicalJson(manifest), "utf8"),
    createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" }),
    Buffer.from(signatureBase64, "base64"),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
      return Object.fromEntries(entries);
    }
    return v;
  });
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
