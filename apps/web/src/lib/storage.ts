import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "./env";

/**
 * Server-side archive storage for marketplace skills (docs/plan/03 §6.4). Files
 * live outside the web root and are only served through the authenticated
 * /api/v1/skills/[id]/archive route. In production this becomes object storage.
 */
function storageRoot(): string {
  return resolve(process.cwd(), env.STORAGE_DIR);
}

/** Resolves a stored relative path inside the root; rejects traversal. */
function safeJoin(relative: string): string {
  const root = storageRoot();
  const full = resolve(root, relative);
  if (!full.startsWith(root + "/") && full !== root) {
    throw new Error("path traversal rejected");
  }
  return full;
}

export async function saveArchive(data: Buffer): Promise<{ relativePath: string; sha256: string; size: number }> {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  const relativePath = `skills/${createHash("sha256").update(data).digest("hex")}.tar`;
  await writeFile(safeJoin(relativePath), data, { mode: 0o600 });
  return { relativePath, sha256: createHash("sha256").update(data).digest("hex"), size: data.length };
}

export async function readArchive(relativePath: string): Promise<Buffer> {
  return readFile(safeJoin(relativePath));
}
