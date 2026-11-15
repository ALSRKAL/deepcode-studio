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

  // sha2 for electron-updater is base64(SHA-256); our rows store hex.
  const sha2 = Buffer.from(latest.sha256, "hex").toString("base64");
  const manifest: ElectronManifest = ElectronManifestSchema.parse({
    version: latest.version,
    releaseDate: (latest.publishedAt ?? latest.createdAt).toISOString(),
    files: [{ url: latest.url, sha2, size: Number(latest.sizeBytes) }],
  });

  return new Response(stringify(manifest), {
    status: 200,
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
