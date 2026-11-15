import { and, eq, sql } from "drizzle-orm";
import { PLAN_TIERS } from "@deepcode/shared";
import { marketplaceSkills, plans, subscriptions } from "@deepcode/db";
import { db } from "@/lib/db";
import { authenticateVirtualKey } from "@/lib/virtualKeyAuth";
import { readArchive } from "@/lib/storage";

/**
 * GET /api/v1/skills/[id]/archive — authenticated download of a marketplace skill
 * archive (docs/plan/01 §8.2). The device key's plan tier must cover the skill;
 * the stored path is server-side only and traversal-safe (lib/storage.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const ctx = await authenticateVirtualKey(request);
  if (!ctx || ctx.userStatus !== "active") {
    return new Response(JSON.stringify({ error: { code: "invalid_api_key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return new Response(JSON.stringify({ error: { code: "bad_request" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const [skill] = await db()
    .db.select()
    .from(marketplaceSkills)
    .where(and(eq(marketplaceSkills.id, id), eq(marketplaceSkills.status, "published")))
    .limit(1);
  if (!skill) {
    return new Response(JSON.stringify({ error: { code: "not_found" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Tier gate: the requester's live plan must meet the skill's minimum tier.
  const [sub] = await db()
    .db.select({ tier: plans.tier })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.userId, ctx.userId),
        sql`${subscriptions.status} in ('trialing','active','past_due')`,
        sql`${subscriptions.expiresAt} > now()`,
      ),
    )
    .limit(1);
  const tier = sub?.tier ?? "free";
  if (PLAN_TIERS.indexOf(tier) < PLAN_TIERS.indexOf(skill.minTier)) {
    return new Response(JSON.stringify({ error: { code: "plan_too_low" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const data = await readArchive(skill.archivePath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${skill.slug}.tar"`,
        "x-sha256": skill.sha256,
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: { code: "archive_missing" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}
