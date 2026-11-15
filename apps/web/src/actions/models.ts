"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { clientIp, requireAdmin } from "@/lib/guards";
import { invalidateGateway } from "@/lib/gateway";
import { audit } from "@/lib/audit";
import { UPSTREAM_API_TYPES } from "@deepcode/shared";
import {
  addModelsToPlan,
  saveProvider,
  setModelPlans,
  setModelPrice,
  updateModel,
  updatePlan,
  type ProviderInput,
} from "@/lib/modelAdmin";
import { syncProviderModels, type SyncReport } from "@/lib/modelCatalog/sync";

/**
 * Admin actions for providers, models and plans (owner request 2026-11-15).
 * Every change reloads the gateway catalog at once; plan changes reach users'
 * cached snapshots within 30 seconds.
 */
async function actor() {
  const admin = await requireAdmin();
  return { id: admin.id, ip: await clientIp() };
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string, fallback = 0) => {
  const n = Number(text(f, k));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const nullable = (v: string) => (v === "" ? null : v);

export interface ActionState {
  ok?: boolean;
  error?: string;
  report?: SyncReport;
}

export async function saveProviderAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const a = await actor();
  const baseUrls: Record<string, string> = {};
  for (const type of UPSTREAM_API_TYPES) {
    const v = text(f, `baseUrl:${type}`);
    if (v) baseUrls[type] = v;
  }
  const input: ProviderInput = {
    id: text(f, "id"),
    displayName: text(f, "displayName"),
    baseUrls: baseUrls as ProviderInput["baseUrls"],
    catalogFormat: (text(f, "catalogFormat") || "manual") as ProviderInput["catalogFormat"],
    modelsUrl: nullable(text(f, "modelsUrl")),
    hideModelPattern: nullable(text(f, "hideModelPattern")),
    sessionHeader: nullable(text(f, "sessionHeader")),
    enabled: bool(f, "enabled"),
    isFallback: bool(f, "isFallback"),
    priority: int(f, "priority"),
  };
  const r = await saveProvider(db().db, a, input);
  if (!r.ok) return { error: r.code };
  await invalidateGateway({ reloadCatalog: true, reloadPool: true });
  revalidatePath("/admin/providers");
  return { ok: true };
}

export async function syncProviderAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const a = await actor();
  const providerId = text(f, "providerId");
  try {
    const report = await syncProviderModels(db().db, providerId);
    await audit(db().db, {
      actorId: a.id,
      action: "provider.sync",
      targetType: "provider",
      targetId: providerId,
      metadata: { added: report.added.length, updated: report.updated, retired: report.retired.length, hidden: report.hidden.length },
      ip: a.ip,
    });
    await invalidateGateway({ reloadCatalog: true });
    revalidatePath("/admin/providers");
    revalidatePath("/admin/models");
    return { ok: true, report };
  } catch (error) {
    return { error: error instanceof Error ? error.message.slice(0, 200) : "sync_failed" };
  }
}

export async function updateModelAction(f: FormData): Promise<void> {
  const a = await actor();
  await updateModel(db().db, a, {
    id: text(f, "id"),
    displayName: text(f, "displayName"),
    status: text(f, "status") === "hidden" ? "hidden" : "active",
    badge: text(f, "badge") as "" | "new" | "recommended" | "beta",
    sortOrder: int(f, "sortOrder", 100),
  });
  await invalidateGateway({ reloadCatalog: true });
  revalidatePath("/admin/models");
}

export async function setModelPriceAction(f: FormData): Promise<void> {
  const a = await actor();
  await setModelPrice(db().db, a, {
    id: text(f, "id"),
    input: int(f, "input", -1),
    output: int(f, "output", -1),
    cached: int(f, "cached", -1),
  });
  await invalidateGateway({ reloadCatalog: true });
  revalidatePath("/admin/models");
}

export async function setModelPlansAction(f: FormData): Promise<void> {
  const a = await actor();
  const planIds = f.getAll("planIds").map(String).filter(Boolean);
  await setModelPlans(db().db, a, { id: text(f, "id"), planIds });
  revalidatePath("/admin/models");
  revalidatePath("/admin/plans");
}

export async function addModelsToPlanAction(f: FormData): Promise<void> {
  const a = await actor();
  const selection = text(f, "selection") === "provider" ? "provider" : "free";
  await addModelsToPlan(db().db, a, { planId: text(f, "planId"), selection, providerId: text(f, "providerId") || undefined });
  revalidatePath("/admin/models");
  revalidatePath("/admin/plans");
}

export async function updatePlanAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const a = await actor();
  const maxOut = text(f, "maxOutputTokens");
  const r = await updatePlan(db().db, a, {
    id: text(f, "id"),
    nameEn: text(f, "nameEn"),
    nameAr: text(f, "nameAr"),
    priceMinor: Math.round(Number(text(f, "price")) * 100),
    currency: text(f, "currency"),
    creditsPerPeriod: int(f, "creditsPerPeriod", -1),
    rpmLimit: int(f, "rpmLimit", -1),
    maxConcurrentStreams: int(f, "maxConcurrentStreams", -1),
    maxKeys: int(f, "maxKeys", -1),
    maxDevices: int(f, "maxDevices", -1),
    maxOutputTokens: maxOut === "" ? null : int(f, "maxOutputTokens", -1),
    isPublic: bool(f, "isPublic"),
    sortOrder: int(f, "sortOrder", 0),
    fallbackEnabled: bool(f, "fallbackEnabled"),
  });
  revalidatePath("/admin/plans");
  revalidatePath("/pricing");
  return r.ok ? { ok: true } : { error: r.code };
}
