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
    return new Response(JSON.stringify({ error: { code: "not_found" } }), {
      status: 404,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
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

  // sha2 for electron-updater is base64(SHA-256); our rows store hex.
  const manifest: ElectronManifest = ElectronManifestSchema.parse({
    version: latest.version,
    releaseDate: (latest.publishedAt ?? latest.createdAt).toISOString(),
    files: rows.map((r) => ({ url: r.url, sha2: Buffer.from(r.sha256, "hex").toString("base64"), size: Number(r.sizeBytes) })),
  });

  return new Response(stringify(manifest), {
    status: 200,
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
