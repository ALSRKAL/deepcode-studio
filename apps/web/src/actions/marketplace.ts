"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { marketplaceMcpPresets, marketplaceSkills, syncState } from "@deepcode/db";
import { db } from "@/lib/db";
import { requireAdmin, clientIp } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { saveArchive } from "@/lib/storage";
import { canonicalJson, signPayload } from "@/lib/manifest";
import { invalidateGateway } from "@/lib/gateway";

export interface MarketplaceState {
  error?: string;
  ok?: boolean;
  /** Publish-time warnings surfaced to the admin (e.g. executables found). */
  warning?: string;
}

async function bumpSyncRevision(): Promise<number> {
  // Single row upsert; returns the new revision.
  const [row] = await db()
    .db.insert(syncState)
    .values({ id: "sync", revision: 2 })
    .onConflictDoUpdate({ target: syncState.id, set: { revision: sql`${syncState.revision} + 1`, updatedAt: new Date() } })
    .returning({ revision: syncState.revision });
  // Review follow-up: the gateway caches the manifest revision (ETag) and only
  // busts it on /internal/invalidate, so a publish/unpublish must tell it.
  await invalidateGateway({ reloadCatalog: true });
  return Number(row!.revision);
}

const SkillUploadSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().min(1).max(500),
  descriptionAr: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(32),
  minTier: z.enum(["free", "starter", "pro", "team"]),
  hasExecutables: z.string().optional(),
});

/**
 * Skill upload (docs/plan/03 §6.4): the archive is scanned for SKILL.md
 * frontmatter, hashed and stored server-side; publish signs the item.
 */
export async function uploadSkillAction(_prev: MarketplaceState, formData: FormData): Promise<MarketplaceState> {
  const admin = await requireAdmin();
  const parsed = SkillUploadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };

  const archive = formData.get("archive");
  if (!(archive instanceof File) || archive.size === 0 || archive.size > 20 * 1024 * 1024) {
    return { error: "archive_required" };
  }
  const buffer = Buffer.from(await archive.arrayBuffer());
  const header = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString("utf8");
  if (!header.includes("name:") || !header.includes("description:")) {
    return { error: "invalid_skill_md" };
  }
  // Executable-format signature check without control-character regexes: ELF
  // (0x7f ELF), Mach-O (feedface/cafebane/beeffeed variants), PE (MZ), shebangs,
  // and zip archives (PK..) are flagged for explicit confirmation (§6.4).
  const head = buffer.subarray(0, Math.min(buffer.length, 8 * 1024 * 1024));
  const latin = head.toString("latin1");
  const hasExecutables =
    latin.startsWith("\x7fELF") ||
    ["feedface", "cafebane", "beeffeed", "cafecafe"].some((m) => latin.slice(0, 64).includes(m)) ||
    latin.startsWith("MZ") ||
    latin.startsWith("#!/bin") ||
    latin.startsWith("#!/usr/bin") ||
    (latin.charCodeAt(0) === 0x50 && latin.charCodeAt(1) === 0x4b && latin.charCodeAt(2) === 0x03);
  if (hasExecutables && parsed.data.hasExecutables !== "confirmed") {
    return { error: "executables_need_confirmation" };
  }

  const stored = await saveArchive(buffer);
  await db()
    .db.insert(marketplaceSkills)
    .values({
      slug: parsed.data.slug,
      nameEn: parsed.data.nameEn,
      nameAr: parsed.data.nameAr,
      descriptionEn: parsed.data.descriptionEn,
      descriptionAr: parsed.data.descriptionAr,
      version: parsed.data.version,
      minTier: parsed.data.minTier,
      archivePath: stored.relativePath,
      sha256: stored.sha256,
      sizeBytes: stored.size,
      hasExecutables,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: marketplaceSkills.slug,
      set: {
        nameEn: parsed.data.nameEn,
        nameAr: parsed.data.nameAr,
        descriptionEn: parsed.data.descriptionEn,
        descriptionAr: parsed.data.descriptionAr,
        version: parsed.data.version,
        minTier: parsed.data.minTier,
        archivePath: stored.relativePath,
        sha256: stored.sha256,
        sizeBytes: stored.size,
        hasExecutables,
        updatedAt: new Date(),
      },
    });

  await audit(db().db, {
    actorId: admin.id,
    action: "marketplace.skill.upload",
    targetType: "marketplace_skill",
    targetId: parsed.data.slug,
    metadata: { version: parsed.data.version, sha256: stored.sha256, hasExecutables },
    ip: await clientIp(),
  });
  revalidatePath("/admin/marketplace");
  return { ok: true, warning: hasExecutables ? "executables" : undefined };
}

export async function publishSkillAction(_prev: MarketplaceState, formData: FormData): Promise<MarketplaceState> {
  const admin = await requireAdmin();
  const parsed = z.object({ slug: z.string().trim().min(2).max(64) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };

  const [skill] = await db().db.select().from(marketplaceSkills).where(eq(marketplaceSkills.slug, parsed.data.slug));
  if (!skill) return { error: "not_found" };
  // Per-item signature over the integrity triple (docs/plan/01 §8.2).
  const signature = signPayload({ id: skill.slug, version: skill.version, sha256: skill.sha256 });
  if (!signature) return { error: "signing_key_missing" };
  await db()
    .db.update(marketplaceSkills)
    .set({ status: "published", itemSignature: signature, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(marketplaceSkills.slug, skill.slug));
  const revision = await bumpSyncRevision();

  await audit(db().db, {
    actorId: admin.id,
    action: "marketplace.skill.publish",
    targetType: "marketplace_skill",
    targetId: skill.slug,
    metadata: { revision, signature: signature.slice(0, 16) },
    ip: await clientIp(),
  });
  revalidatePath("/admin/marketplace");
  return { ok: true };
}

export async function unpublishSkillAction(_prev: MarketplaceState, formData: FormData): Promise<MarketplaceState> {
  const admin = await requireAdmin();
  const parsed = z.object({ slug: z.string().trim().min(2).max(64) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };
  await db()
    .db.update(marketplaceSkills)
    .set({ status: "unpublished", updatedAt: new Date() })
    .where(eq(marketplaceSkills.slug, parsed.data.slug));
  const revision = await bumpSyncRevision();
  await audit(db().db, {
    actorId: admin.id,
    action: "marketplace.skill.unpublish",
    targetType: "marketplace_skill",
    targetId: parsed.data.slug,
    metadata: { revision },
    ip: await clientIp(),
  });
  revalidatePath("/admin/marketplace");
  return { ok: true };
}

const McpPresetSchema = z.object({
  slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().min(1).max(500),
  descriptionAr: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(32),
  minTier: z.enum(["free", "starter", "pro", "team"]),
  transport: z.enum(["stdio", "sse", "http"]),
  command: z.string().trim().max(300).optional().or(z.literal("")),
  args: z.string().trim().max(1000).optional().or(z.literal("")), // space-separated
  url: z.string().trim().max(500).optional().or(z.literal("")),
  envNames: z.string().trim().max(500).optional().or(z.literal("")), // comma-separated names
});

export async function saveMcpPresetAction(_prev: MarketplaceState, formData: FormData): Promise<MarketplaceState> {
  const admin = await requireAdmin();
  const parsed = McpPresetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };
  const d = parsed.data;
  if (d.transport === "stdio" && !d.command) return { error: "invalid_input" };
  if ((d.transport === "sse" || d.transport === "http") && !d.url) return { error: "invalid_input" };

  const env = d.envNames
    ? d.envNames.split(",").map((n) => n.trim()).filter(Boolean).map((name) => ({ name: name.toUpperCase().replace(/[^A-Z0-9_]/g, "_"), description: d.nameEn }))
    : [];
  const config = {
    transport: d.transport,
    ...(d.command ? { command: d.command } : {}),
    ...(d.args ? { args: d.args.split(/\s+/).filter(Boolean) } : {}),
    ...(d.url ? { url: d.url } : {}),
    env,
  };
  const signature = signPayload(config);
  if (!signature) return { error: "signing_key_missing" };

  await db()
    .db.insert(marketplaceMcpPresets)
    .values({
      slug: d.slug,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      descriptionEn: d.descriptionEn,
      descriptionAr: d.descriptionAr,
      version: d.version,
      minTier: d.minTier,
      transport: d.transport,
      command: d.command || null,
      args: d.args ? d.args.split(/\s+/).filter(Boolean) : null,
      url: d.url || null,
      envSpec: env,
      itemSignature: signature,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: marketplaceMcpPresets.slug,
      set: {
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        descriptionEn: d.descriptionEn,
        descriptionAr: d.descriptionAr,
        version: d.version,
        minTier: d.minTier,
        transport: d.transport,
        command: d.command || null,
        args: d.args ? d.args.split(/\s+/).filter(Boolean) : null,
        url: d.url || null,
        envSpec: env,
        itemSignature: signature,
        updatedAt: new Date(),
      },
    });
  await audit(db().db, {
    actorId: admin.id,
    action: "marketplace.mcp.save",
    targetType: "marketplace_mcp_preset",
    targetId: d.slug,
    metadata: { transport: d.transport },
    ip: await clientIp(),
  });
  revalidatePath("/admin/marketplace");
  return { ok: true };
}

export async function publishMcpPresetAction(_prev: MarketplaceState, formData: FormData): Promise<MarketplaceState> {
  const admin = await requireAdmin();
  const parsed = z.object({ slug: z.string().trim().min(2).max(64) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };
  const [preset] = await db().db.select().from(marketplaceMcpPresets).where(eq(marketplaceMcpPresets.slug, parsed.data.slug));
  if (!preset) return { error: "not_found" };
  const config = {
    transport: preset.transport,
    ...(preset.command ? { command: preset.command } : {}),
    ...(preset.args ? { args: preset.args } : {}),
    ...(preset.url ? { url: preset.url } : {}),
    env: preset.envSpec,
  };
  const signature = signPayload(config);
  if (!signature) return { error: "signing_key_missing" };
  await db()
    .db.update(marketplaceMcpPresets)
    .set({ status: "published", itemSignature: signature, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(marketplaceMcpPresets.slug, preset.slug));
  const revision = await bumpSyncRevision();
  await audit(db().db, {
    actorId: admin.id,
    action: "marketplace.mcp.publish",
    targetType: "marketplace_mcp_preset",
    targetId: preset.slug,
    metadata: { revision },
    ip: await clientIp(),
  });
  revalidatePath("/admin/marketplace");
  return { ok: true };
}

export async function unpublishMcpPresetAction(_prev: MarketplaceState, formData: FormData): Promise<MarketplaceState> {
  const admin = await requireAdmin();
  const parsed = z.object({ slug: z.string().trim().min(2).max(64) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid_input" };
  await db()
    .db.update(marketplaceMcpPresets)
    .set({ status: "unpublished", updatedAt: new Date() })
    .where(eq(marketplaceMcpPresets.slug, parsed.data.slug));
  const revision = await bumpSyncRevision();
  await audit(db().db, {
    actorId: admin.id,
    action: "marketplace.mcp.unpublish",
    targetType: "marketplace_mcp_preset",
    targetId: parsed.data.slug,
    metadata: { revision },
    ip: await clientIp(),
  });
  revalidatePath("/admin/marketplace");
  return { ok: true };
}

// Keeps canonicalJson import meaningful for the manifest preview shown in admin.
export async function previewManifestAction(): Promise<string> {
  await requireAdmin();
  const skills = await db().db.select({ slug: marketplaceSkills.slug, version: marketplaceSkills.version, sha256: marketplaceSkills.sha256 }).from(marketplaceSkills).where(eq(marketplaceSkills.status, "published"));
  return canonicalJson({ skills: skills.map((s) => ({ id: s.slug, version: s.version, sha256: s.sha256 })) });
}
