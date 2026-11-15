import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { firebaseAdminConfigured, utrSeenInSmmDeposits, verifyPhoneAdmin } from "@/lib/firebaseAdmin";
import { approveUpiPayment, rejectUpiPayment } from "@/lib/billing/upi";

const BodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(300).optional(),
});

/**
 * POST /api/admin/upi-payments/{id} {action: "approve"|"reject", reason?} — the
 * admin phone app confirms that the money arrived (approve) or not (reject).
 * Approve is idempotent-safe: only a `submitted` payment can be claimed once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!firebaseAdminConfigured()) return json({ error: { code: "not_configured" } }, 503);
  const admin = await verifyPhoneAdmin(request);
  if (!admin) return json({ error: { code: "unauthorized" } }, 401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: { code: "bad_request" } }, 400);
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: { code: "bad_request" } }, 400);

  const reviewer = `firebase:${admin.uid}`;
  const handle = db().db;
  const result =
    body.data.action === "approve"
      ? await approveUpiPayment(handle, { id, reviewer, isUtrUsedElsewhere: utrSeenInSmmDeposits })
      : await rejectUpiPayment(handle, { id, reviewer, reason: body.data.reason });
  if (!result.ok) return json({ error: { code: result.code } }, result.code === "not_found" ? 404 : 409);

  await audit(handle, {
    actorId: null,
    action: `upi_payment.${body.data.action}`,
    targetType: "upi_payment",
    targetId: id,
    metadata: { reviewer, via: "phone", email: admin.email, reason: body.data.reason ?? null },
  });
  return json({ ok: true }, 200);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
