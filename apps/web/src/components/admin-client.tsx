"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  addPoolKeyAction,
  setPoolKeyStatusAction,
  adjustCreditsAction,
  setUserStatusAction,
  assignPlanAction,
  revokeAllKeysAction,
  type AdminActionState,
} from "@/actions/admin";

const input =
  "h-10 rounded-sm border border-border bg-surface px-3 text-[14px] placeholder:text-fg-subtle disabled:opacity-50";

export function PoolSummary({
  healthy,
  cooling,
  failed,
  utilization,
}: {
  healthy: number;
  cooling: number;
  failed: number;
  utilization: number;
}) {
  const t = useTranslations("admin");
  return (
    <p className="text-[13px] text-fg-muted leading-6">
      {t("poolSummary", { healthy, cooling, failed, utilization })}
    </p>
  );
}

/** Write-only key form (docs/plan/04 §3.1, W-08): the key is never echoed. */
export function AddPoolKeyForm({ providers }: { providers: Array<{ id: string; displayName: string }> }) {
  const t = useTranslations("admin");
  const [state, action] = useActionState<AdminActionState, FormData>(addPoolKeyAction, {});
  return (
    <form action={action} className="grid gap-3 max-w-md">
      {state.ok ? (
        <p role="status" className="text-[13px] text-success">
          ✓ {t("added")} <span className="font-mono">{state.fingerprint}</span>
        </p>
      ) : null}
      {state.error ? <p role="alert" className="text-[13px] text-danger">{state.error}</p> : null}
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">provider</span>
        <select name="providerId" className={input} required>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">{t("keyLabel")}</span>
        <input name="label" className={input} required maxLength={100} />
      </label>
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">{t("keyValue")}</span>
        <input name="key" type="password" className={`${input} font-mono`} required autoComplete="off" />
      </label>
      <div className="flex gap-3">
        <label className="grid gap-1.5 text-[14px] w-28">
          <span className="text-fg-muted">{t("keyWeight")}</span>
          <input name="weight" type="number" min={1} max={100} defaultValue={1} className={input} />
        </label>
        <label className="grid gap-1.5 text-[14px] w-28">
          <span className="text-fg-muted">{t("keyConcurrency")}</span>
          <input name="maxConcurrency" type="number" min={1} max={64} defaultValue={8} className={input} />
        </label>
      </div>
      <button type="submit" className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover justify-self-start">
        {t("addKey")}
      </button>
    </form>
  );
}

export function PoolKeyStatusButton({ keyId, status }: { keyId: string; status: "active" | "disabled" }) {
  const t = useTranslations("admin");
  const [, action] = useActionState<AdminActionState, FormData>(setPoolKeyStatusAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="keyId" value={keyId} />
      <input type="hidden" name="status" value={status === "active" ? "disabled" : "active"} />
      <button
        type="submit"
        className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-[13px] text-fg-muted hover:text-fg hover:bg-surface-2"
      >
        {status === "active" ? t("disable") : t("enable")}
      </button>
    </form>
  );
}

export function AdjustCreditsForm({ subscriptionId }: { subscriptionId: string }) {
  const t = useTranslations("admin");
  const [state, action] = useActionState<AdminActionState, FormData>(adjustCreditsAction, {});
  return (
    <form action={action} className="grid gap-3 max-w-md">
      {state.ok ? <p role="status" className="text-[13px] text-success">✓</p> : null}
      {state.error ? <p role="alert" className="text-[13px] text-danger">{state.error}</p> : null}
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">{t("delta")}</span>
        <input name="deltaCredits" type="number" required className={`${input} font-mono tabular`} />
      </label>
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">{t("reason")}</span>
        <input name="reason" required minLength={3} maxLength={500} className={input} />
      </label>
      <button type="submit" className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover justify-self-start">
        {t("adjustCredits")}
      </button>
    </form>
  );
}

export function UserStatusButton({ userId, status }: { userId: string; status: "active" | "suspended" }) {
  const t = useTranslations("admin");
  const [, action] = useActionState<AdminActionState, FormData>(setUserStatusAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={status === "active" ? "suspended" : "active"} />
      <button
        type="submit"
        className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-[13px] text-fg-muted hover:text-fg hover:bg-surface-2"
      >
        {status === "active" ? t("suspend") : t("unsuspend")}
      </button>
    </form>
  );
}

export function AssignPlanForm({ userId, planIds }: { userId: string; planIds: string[] }) {
  const t = useTranslations("admin");
  const [state, action] = useActionState<AdminActionState, FormData>(assignPlanAction, {});
  return (
    <form action={action} className="flex items-end gap-2">
      {state.ok ? <p className="text-[13px] text-success">✓</p> : null}
      {state.error ? <p className="text-[13px] text-danger">{state.error}</p> : null}
      <input type="hidden" name="userId" value={userId} />
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">{t("assignPlan")}</span>
        <select name="planId" className={input}>
          {planIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-[14px] w-24">
        <span className="text-fg-muted">{t("days")}</span>
        <input name="days" type="number" min={1} max={3650} defaultValue={30} className={input} />
      </label>
      <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
        {t("assignPlan")}
      </button>
    </form>
  );
}

export function RevokeAllKeysButton({ userId }: { userId: string }) {
  const t = useTranslations("admin");
  const [state, action] = useActionState<AdminActionState, FormData>(revokeAllKeysAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        className="inline-flex h-8 items-center rounded-sm border border-danger/40 px-3 text-[13px] text-danger hover:bg-danger/10"
      >
        {t("revokeAllKeys")}
      </button>
      {state.ok ? <span className="ms-2 text-[13px] text-success">✓</span> : null}
    </form>
  );
}
