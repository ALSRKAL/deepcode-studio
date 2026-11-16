import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { releases } from "@deepcode/db";
import { db } from "@/lib/db";

/**
 * GET /api/v1/releases/latest?platform=win|mac|linux&arch=x64|arm64&kind=exe|zip|dmg|AppImage|deb|rpm
 * The newest published stable installer of that kind, as JSON — used by the
 * one-line install scripts (/install.ps1, /install.sh), which verify sha256.
 */
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const platform = q.get("platform") as "win" | "mac" | "linux";
  const arch = q.get("arch") as "x64" | "arm64";
  const kind = q.get("kind") ?? "";
  if (!["win", "mac", "linux"].includes(platform ?? "") || !["x64", "arm64"].includes(arch ?? "") || !/^[A-Za-z]{2,10}$/.test(kind)) {
    return Response.json({ error: { code: "bad_request" } }, { status: 400 });
  }
  const [row] = await db()
    .db.select()
    .from(releases)
    .where(
      and(
        eq(releases.channel, "stable"),
        eq(releases.platform, platform),
        eq(releases.arch, arch),
        sql`lower(${releases.fileKind}) = ${kind.toLowerCase()}`,
        isNotNull(releases.publishedAt),
      ),
    )
    .orderBy(desc(sql`${releases.publishedAt}`))
    .limit(1);
  if (!row) return Response.json({ error: { code: "not_found" } }, { status: 404, headers: { "cache-control": "no-store" } });
  return Response.json(
    { version: row.version, url: row.url, sha256: row.sha256, sizeBytes: Number(row.sizeBytes) },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
