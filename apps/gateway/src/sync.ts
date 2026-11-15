import { and, eq, sql } from "drizzle-orm";
import { marketplaceMcpPresets, marketplaceSkills, syncState, type Database } from "@deepcode/db";
import { PLAN_TIERS, type SyncManifest } from "@deepcode/shared";
import type { AuthSnapshot } from "./auth.js";

/**
 * GET /v1/sync/manifest (docs/plan/01 §8.2, doc 02 §2). Authenticated with the
 * device key; the manifest is tier-filtered server-side. Integrity is per item:
 * every skill archive hash is signed at publish time (Ed25519, key held by the
 * web portal), so a compromised storage host cannot push a skill.
 */
export class SyncService {
  #revision = -1;

  constructor(
    private readonly deps: {
      db: Database;
      webUrl: () => string;
      now?: () => number;
    },
  ) {}

  async revision(): Promise<number> {
    if (this.#revision >= 0) return this.#revision;
    const [row] = await this.deps.db.select().from(syncState).where(eq(syncState.id, "sync"));
    this.#revision = Number(row?.revision ?? 1);
    return this.#revision;
  }

  /** Invalidated from the web's invalidate call (reloadCatalog also busts this). */
  invalidate(): void {
    this.#revision = -1;
  }

  /**
   * Review L12: the manifest tier must come from a LIVE, unexpired subscription
   * (the archive route already re-checks; this keeps paid-tier metadata out of
   * expired accounts too). past_due keeps its grace, matching lockReason().
   */
  tierOf(snapshot: AuthSnapshot, now: number): (typeof PLAN_TIERS)[number] {
    const sub = snapshot.subscription;
    if (!sub) return "free";
    const live = sub.status === "trialing" || sub.status === "active";
    const graceOk =
      sub.status === "past_due" && now < sub.expiresAt + sub.plan.pastDueGraceHours * 3_600_000;
    if (!live && !graceOk) return "free";
    if (live && now >= sub.expiresAt) return "free";
    return sub.plan.tier;
  }

  async manifestFor(snapshot: AuthSnapshot): Promise<{ manifest: SyncManifest } | { status: number; retryAfterSec?: number }> {
    const tierIndex = PLAN_TIERS.indexOf(this.tierOf(snapshot, (this.deps.now ?? Date.now)()));
    const webUrl = this.deps.webUrl().replace(/\/$/, "");

    const skills = await this.deps.db
      .select()
      .from(marketplaceSkills)
      .where(
        and(
          eq(marketplaceSkills.status, "published"),
          sql`${marketplaceSkills.minTier} in (${sql.join(
            PLAN_TIERS.slice(0, tierIndex + 1).map((t) => sql`${t}`),
            sql`, `,
          )})`,
        ),
      );
    const presets = await this.deps.db
      .select()
      .from(marketplaceMcpPresets)
      .where(
        and(
          eq(marketplaceMcpPresets.status, "published"),
          sql`${marketplaceMcpPresets.minTier} in (${sql.join(
            PLAN_TIERS.slice(0, tierIndex + 1).map((t) => sql`${t}`),
            sql`, `,
          )})`,
        ),
      );

    return {
      manifest: {
        revision: await this.revision(),
        skills: skills.map((s) => ({
          id: s.slug,
          name: s.nameEn,
          version: s.version,
          sha256: s.sha256,
          url: `${webUrl}/api/v1/skills/${s.id}/archive`,
          minTier: s.minTier,
          signature: s.itemSignature ?? "",
        })),
        mcpPresets: presets.map((p) => ({
          id: p.slug,
          name: p.nameEn,
          version: p.version,
          minTier: p.minTier,
          config: {
            transport: p.transport,
            ...(p.command ? { command: p.command } : {}),
            ...(p.args ? { args: p.args } : {}),
            ...(p.url ? { url: p.url } : {}),
            env: p.envSpec,
          },
          signature: p.itemSignature ?? "",
        })),
      },
    };
  }
}
