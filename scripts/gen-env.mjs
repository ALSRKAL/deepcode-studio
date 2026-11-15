#!/usr/bin/env node
/**
 * Generates local secrets for .env without ever echoing existing values.
 * Adds only what is missing (idempotent). Values stay in .env, which is git-ignored.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env");

const lines = readFileSync(envPath, "utf8").split("\n");
const current = new Map();
for (const line of lines) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && m[2]) current.set(m[1], m[2]);
}

const b64 = (n) => randomBytes(n).toString("base64");

const wanted = {
  KEY_HASH_PEPPER: () => b64(32),
  POOL_KEY_ENCRYPTION_KEY: () => b64(32),
  GATEWAY_INTERNAL_TOKEN: () => randomBytes(32).toString("hex"),
  AUTH_SECRET: () => b64(48),
  MOCK_BILLING_WEBHOOK_SECRET: () => b64(32),
  MANIFEST_SIGNING_KEY: () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    return privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  },
};

let changed = 0;
const out = lines.map((line) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !m[2] && wanted[m[1]]) {
    changed += 1;
    return `${m[1]}=${wanted[m[1]]()}`;
  }
  return line;
});

// Append any wanted variables missing entirely.
for (const [name, gen] of Object.entries(wanted)) {
  if (!current.has(name) && !out.some((l) => l.startsWith(`${name}=`))) {
    out.push(`${name}=${gen()}`);
    changed += 1;
  }
}

writeFileSync(envPath, out.join("\n"), { mode: 0o600 });
console.log(`env secrets generated: ${changed} value(s) added (values never printed)`);
