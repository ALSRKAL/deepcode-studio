"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { createApiKey, rotateApiKey, revokeApiKey } from "@/lib/apiKeys";
import { invalidateGateway } from "@/lib/gateway";
import { requireUser } from "@/lib/guards";

/**
 * Virtual key management (docs/plan/03 §5, API keys page). The lifecycle lives in
 * lib/apiKeys.ts (unit-testable); these actions only bind it to the session and
 * revalidate. The full key is returned exactly once — shown once at creation and
 * on rotation, never again.
 */

export interface KeyActionState {
  error?: string;
  /** The plaintext key on create/rotate. Rendered once, never stored client-side. */
  key?: string;
}

const NameSchema = z.string().trim().min(1).max(100);

export async function createApiKeyAction(_prev: KeyActionState, formData: FormData): Promise<KeyActionState> {
  const parsed = NameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: "invalid_name" };
  const user = await requireUser();
  const outcome = await createApiKey(db().db, user.id, parsed.data);
  if (!outcome.ok) return { error: "max_keys" };
  await invalidateGateway({ userIds: [user.id] });
  revalidatePath("/dashboard/keys");
  return { key: outcome.key };
}

export async function rotateApiKeyAction(_prev: KeyActionState, formData: FormData): Promise<KeyActionState> {
  const keyId = z.string().uuid().safeParse(formData.get("keyId"));
  if (!keyId.success) return { error: "invalid_request" };
  const user = await requireUser();
  const outcome = await rotateApiKey(db().db, user.id, keyId.data);
  if (!outcome.ok) return { error: "not_found" };
  if (outcome.revokedHash) await invalidateGateway({ keyHashes: [outcome.revokedHash] });
  revalidatePath("/dashboard/keys");
  return { key: outcome.key };
}

export async function revokeApiKeyAction(
  _prev: { error?: string; ok?: boolean },
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const keyId = z.string().uuid().safeParse(formData.get("keyId"));
  if (!keyId.success) return { error: "invalid_request" };
  const user = await requireUser();
  const outcome = await revokeApiKey(db().db, user.id, keyId.data);
  if (!outcome.ok) return { error: "not_found" };
  await invalidateGateway({ keyHashes: [outcome.keyHash] });
  revalidatePath("/dashboard/keys");
  return { ok: true };
}
