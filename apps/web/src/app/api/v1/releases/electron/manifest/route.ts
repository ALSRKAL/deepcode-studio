import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { stringify } from "yaml";
import { ElectronManifestSchema, type ElectronManifest } from "@deepcode/shared";
import { releases } from "@deepcode/db";
import { db } from "@/lib/db";

/**
 * GET /api/v1/releases/electron/manifest — the auto-update manifest consumed by
 * the desktop's ManifestUpdateProvider (YAML, electron-updater UpdateInfo; see
 * apps/desktop/src/main/manifestUpdateProvider.ts). Query: platform=<windows|darwin|
 * linux>-<x86_64|aarch64> as the desktop computes it, channel=1 (stable) | 3 (preview).
 * File URLs are resolved relative to this manifest URL by the updater.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") ?? "";
  // "1" = stable, "3" = preview (the desktop maps its channel to these values).
  const channel = url.searchParams.get("channel") === "3" ? "preview" : "stable";

  const match = /^([a-z]+)-(x86_64|aarch64|x86)$/.exec(platform);
  const dbPlatform = match?.[1] === "windows" ? "win" : match?.[1] === "darwin" ? "mac" : match?.[1] === "linux" ? "linux" : null;
  const dbArch = match?.[2] === "x86_64" ? "x64" : match?.[2] === "aarch64" ? "arm64" : null;
  if (!dbPlatform || !dbArch) {
    return new Response(JSON.stringify({ error: { code: "bad_request", message: "platform must be <os>-<arch>" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const key = `${channel}:${dbPlatform}:${dbArch}`;
  const now = Date.now();
  let cached = manifestCache.get(key);
  if (!cached || cached.expiresAt <= now) {
    // One database read per platform per TTL, shared by every concurrent request
    // (2026-11-21 load test: 75 req/s at 1.2 s; every desktop polls this endpoint).
    const pending = buildManifest(channel, dbPlatform, dbArch);
    cached = { expiresAt: now + MANIFEST_CACHE_TTL_MS, result: pending };
    manifestCache.set(key, cached);
    // A failed read must not stay cached.
    pending.catch(() => {
      if (manifestCache.get(key)?.result === pending) manifestCache.delete(key);
    });
  }
  const result = await cached.result;
  return new Response(result.body, { status: result.status, headers: result.headers });
}

type ManifestResult = { status: number; body: string; headers: Record<string, string> };
const MANIFEST_CACHE_TTL_MS = 30_000;
const manifestCache = new Map<string, { expiresAt: number; result: Promise<ManifestResult> }>();

async function buildManifest(
  channel: "stable" | "preview",
  dbPlatform: "win" | "mac" | "linux",
  dbArch: "x64" | "arm64",
): Promise<ManifestResult> {
  const [latest] = await db()
    .db.select()
    .from(releases)
    .where(
      and(
        eq(releases.channel, channel),
        eq(releases.platform, dbPlatform),
        eq(releases.arch, dbArch),
        isNotNull(releases.publishedAt),
      ),
    )
    .orderBy(desc(sql`${releases.publishedAt}`), sql`${releases.version} desc`)
    .limit(1);

  if (!latest) {
    return {
      status: 404,
      body: JSON.stringify({ error: { code: "not_found" } }),
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    };
  }

  // Every installer of that version: the desktop keeps the one its updater can install
  // (.AppImage / .deb / .rpm on Linux, .zip on macOS, .exe on Windows). Listing a single
  // row handed AppImage users an .rpm, which the updater rejects.
  const rows = await db()
    .db.select()
    .from(releases)
    .where(
      and(
        eq(releases.channel, channel),
        eq(releases.platform, dbPlatform),
        eq(releases.arch, dbArch),
        eq(releases.version, latest.version),
        isNotNull(releases.publishedAt),
      ),
    );
  const preferred = [".appimage", ".zip", ".exe", ".deb", ".rpm", ".dmg"];
  const rank = (u: string) => {
    const i = preferred.findIndex((ext) => u.toLowerCase().endsWith(ext));
    return i < 0 ? preferred.length : i;
  };
  rows.sort((a, b) => rank(a.url) - rank(b.url));

  // electron-updater checks sha2 as HEX SHA-256 (builder-util-runtime:
  // new DigestTransform(sha2, "sha256", "hex")). Sending base64 made every downloaded
  // update fail its checksum, so no client could update. Rows store hex already.
  const manifest: ElectronManifest = ElectronManifestSchema.parse({
    version: latest.version,
    releaseDate: (latest.publishedAt ?? latest.createdAt).toISOString(),
    files: rows.map((r) => ({ url: r.url, sha2: r.sha256.toLowerCase(), size: Number(r.sizeBytes) })),
  });

  return {
    status: 200,
    body: stringify(manifest),
    headers: { "content-type": "text/yaml; charset=utf-8", "cache-control": "public, max-age=60" },
  };
}
