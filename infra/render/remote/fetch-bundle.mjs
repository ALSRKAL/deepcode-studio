// Downloads the pinned phone remote bundle and refuses it unless its sha256 matches
// (infra/render/remote/bundle.env). Used by the Docker build; plain Node, no curl needed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(process.argv[2], "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const { REMOTE_WEB_URL: url, REMOTE_WEB_SHA256: expected } = env;
if (!url?.startsWith("https://") || !/^[0-9a-f]{64}$/.test(expected ?? "")) {
  throw new Error("bundle.env needs an https REMOTE_WEB_URL and a 64-hex REMOTE_WEB_SHA256");
}
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) throw new Error(`download failed: ${response.status} ${url}`);
const body = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(body).digest("hex");
if (actual !== expected) throw new Error(`sha256 mismatch: expected ${expected}, got ${actual}`);
writeFileSync(process.argv[3], body);
console.log(`remote bundle ok (${body.length} bytes, sha256 ${actual})`);
