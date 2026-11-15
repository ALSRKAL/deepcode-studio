"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, clientIp } from "@/lib/guards";
import {
  addPoolKey,
  setPoolKeyStatus,
  adjustCredits,
  setUserStatus,
  assignPlan,
  revokeAllKeys,
} from "@/lib/adminActions";
import { approveUpiPayment, rejectUpiPayment } from "@/lib/billing/upi";
import { utrSeenInSmmDeposits } from "@/lib/firebaseAdmin";
import { audit } from "@/lib/audit";

/**
 * Admin actions: session + IP binding around lib/adminActions (docs/plan/03 §6).
 * Every mutation is zod-checked, audited, and invalidates the gateway cache.
 */

export interface AdminActionState {
  error?: string;
  ok?: boolean;
  /** Write-only: the fingerprint shown after creating a pool key. */
  fingerprint?: string;
}

async function adminActor() {
  const admin = await requireAdmin();
  return { id: admin.id, ip: await clientIp() };
}

export async function addPoolKeyAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await adminActor();
  const outcome = await addPoolKey(db().db, admin, {
    providerId: String(formData.get("providerId") ?? ""),
    label: String(formData.get("label") ?? ""),
    plaintext: String(formData.get("key") ?? ""),
    weight: Number(formData.get("weight") ?? 1),
    maxConcurrency: Number(formData.get("maxConcurrency") ?? 8),
  });
  revalidatePath("/admin/pool");
  if (!outcome.ok) return { error: outcome.code };
  return { ok: true, fingerprint: outcome.fingerprint };
}

export async function setPoolKeyStatusAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await adminActor();
  const outcome = await setPoolKeyStatus(db().db, admin, {
    keyId: String(formData.get("keyId") ?? ""),
    status: formData.get("status") === "disabled" ? "disabled" : "active",
  });
  revalidatePath("/admin/pool");
  if (!outcome.ok) return { error: outcome.code };
  return { ok: true };
}

export async function adjustCreditsAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await adminActor();
  const outcome = await adjustCredits(db().db, admin, {
    subscriptionId: String(formData.get("subscriptionId") ?? ""),
    deltaCredits: Number(formData.get("deltaCredits") ?? 0),
    reason: String(formData.get("reason") ?? ""),
  });
  revalidatePath("/admin/users");
  if (!outcome.ok) return { error: outcome.code };
  return { ok: true };
}

export async function setUserStatusAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await adminActor();
  const outcome = await setUserStatus(db().db, admin, {
    userId: String(formData.get("userId") ?? ""),
    status: formData.get("status") === "suspended" ? "suspended" : "active",
  });
  revalidatePath("/admin/users");
  if (!outcome.ok) return { error: outcome.code };
  return { ok: true };
}

export async function assignPlanAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await adminActor();
  const outcome = await assignPlan(db().db, admin, {
    userId: String(formData.get("userId") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    days: Number(formData.get("days") ?? 30),
  });
  revalidatePath("/admin/users");
  if (!outcome.ok) return { error: outcome.code };
  return { ok: true };
}

export async function revokeAllKeysAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await adminActor();
  const outcome = await revokeAllKeys(db().db, admin, { userId: String(formData.get("userId") ?? "") });
  revalidatePath("/admin/users");
  if (!outcome.ok) return { error: outcome.code };
  return { ok: true };
}

/** Web fallback for the phone app: approve/reject a submitted UPI payment. */
export async function reviewUpiPaymentAction(formData: FormData): Promise<void> {
  const admin = await adminActor();
  const id = String(formData.get("paymentId") ?? "");
  const decision = formData.get("decision") === "approve" ? "approve" : "reject";
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  const reviewer = `web:${admin.id}`;
  const handle = db().db;
  const result =
    decision === "approve"
      ? await approveUpiPayment(handle, { id, reviewer, isUtrUsedElsewhere: utrSeenInSmmDeposits })
      : await rejectUpiPayment(handle, { id, reviewer, reason: String(formData.get("reason") ?? "") });
  if (result.ok) {
    await audit(handle, {
      actorId: admin.id,
      action: `upi_payment.${decision}`,
      targetType: "upi_payment",
      targetId: id,
      metadata: { via: "web" },
      ip: admin.ip,
    });
  }
  revalidatePath("/admin/payments");
}
