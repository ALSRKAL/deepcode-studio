import { db } from "@/lib/db";
import { firebaseAdminConfigured, utrSeenInSmmDeposits, verifyPhoneAdmin } from "@/lib/firebaseAdmin";
import { listPaymentsForAdmin } from "@/lib/billing/upi";

/**
 * GET /api/admin/upi-payments?status=submitted|all — for the owner's admin phone
 * app. Auth: Firebase ID token of a user whose Firestore profile has role "admin"
 * (lib/firebaseAdmin.ts). Never cached.
 */
export async function GET(request: Request): Promise<Response> {
  if (!firebaseAdminConfigured()) return json({ error: { code: "not_configured" } }, 503);
  const admin = await verifyPhoneAdmin(request);
  if (!admin) return json({ error: { code: "unauthorized" } }, 401);
  const status = new URL(request.url).searchParams.get("status") === "all" ? "all" : "submitted";
  const payments = await listPaymentsForAdmin(db().db, status, 100, utrSeenInSmmDeposits);
  return json({ payments }, 200);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
