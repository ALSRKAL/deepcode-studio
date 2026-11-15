"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { releases } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin, clientIp } from "@/lib/guards";
import { audit } from "@/lib/audit";

export interface ReleaseState {
  error?: string;
  ok?: boolean;
}

const ReleaseSchema = z.object({
  version: z.string().trim().regex(/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/, "semver"),
  channel: z.enum(["stable", "preview"]),
  platform: z.enum(["win", "mac", "linux"]),
  arch: z.enum(["x64", "arm64"]),
  fileKind: z.enum(["exe", "dmg", "zip", "AppImage", "deb"]),
  url: z.url(),
  sha256: z.string().trim().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.coerce.number().int().nonnegative(),
  notesEn: z.string().trim().max(2000).optional().or(z.literal("")),
  notesAr: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Register a build (docs/plan/03 §6.5): backs downloads + the update manifest. */
export async function registerReleaseAction(_prev: ReleaseState, formData: FormData): Promise<ReleaseState> {
  const admin = await requireAdmin();
  const parsed = ReleaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };
  const d = parsed.data;
  await db()
    .db.insert(releases)
    .values({ ...d, notesEn: d.notesEn || null, notesAr: d.notesAr || null })
    .onConflictDoUpdate({
      target: [releases.version, releases.channel, releases.platform, releases.arch, releases.fileKind],
      set: { url: d.url, sha256: d.sha256, sizeBytes: d.sizeBytes, notesEn: d.notesEn || null, notesAr: d.notesAr || null },
    });
  await audit(db().db, {
    actorId: admin.id,
    action: "release.register",
    targetType: "release",
    targetId: `${d.version}-${d.channel}-${d.platform}-${d.arch}`,
    metadata: { fileKind: d.fileKind, sizeBytes: d.sizeBytes },
    ip: await clientIp(),
  });
  revalidatePath("/admin/releases");
  return { ok: true };
}

export async function publishReleaseAction(_prev: ReleaseState, formData: FormData): Promise<ReleaseState> {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };
  await db().db.update(releases).set({ publishedAt: new Date() }).where(eq(releases.id, parsed.data.id));
  await audit(db().db, {
    actorId: admin.id,
    action: "release.publish",
    targetType: "release",
    targetId: parsed.data.id,
    ip: await clientIp(),
  });
  revalidatePath("/admin/releases");
  return { ok: true };
}
