"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { saveProviderAction, syncProviderAction, updatePlanAction, type ActionState } from "@/actions/models";

const input =
  "h-9 rounded-sm border border-border bg-surface px-2.5 text-[14px] placeholder:text-fg-subtle disabled:opacity-50";
const button =
  "inline-flex h-9 items-center justify-center rounded-sm bg-primary px-4 text-[14px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-60";
const secondary =
  "inline-flex h-9 items-center justify-center rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2 disabled:opacity-60";

const API_TYPES = ["openai-chat-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

export interface ProviderFormValue {
  id: string;
  displayName: string;
  baseUrls: Partial<Record<(typeof API_TYPES)[number], string>>;
  catalogFormat: string;
  modelsUrl: string | null;
  hideModelPattern: string | null;
  sessionHeader: string | null;
  enabled: boolean;
  isFallback: boolean;
  priority: number;
}

const PRESETS: Record<string, ProviderFormValue> = {
  "opencode-go": {
    id: "opencode-go",
    displayName: "OpenCode Go",
    baseUrls: {
      "openai-chat-completions": "https://opencode.ai/inference/go/openai/v1",
      "openai-responses": "https://opencode.ai/inference/go/openai/v1",
      "anthropic-messages": "https://opencode.ai/inference/go/anthropic/v1",
      "google-generative-ai": "https://opencode.ai/inference/go/google/v1beta",
    },
    catalogFormat: "opencode",
    modelsUrl: "https://opencode.ai/inference/go/v1/models",
    hideModelPattern: null,
    sessionHeader: "x-opencode-session",
    enabled: true,
    isFallback: false,
    priority: 0,
  },
  "opencode-zen": {
    id: "opencode-zen",
    displayName: "OpenCode Zen",
    baseUrls: {
      "openai-chat-completions": "https://opencode.ai/inference/openai/v1",
      "openai-responses": "https://opencode.ai/inference/openai/v1",
      "anthropic-messages": "https://opencode.ai/inference/anthropic/v1",
      "google-generative-ai": "https://opencode.ai/inference/google/v1beta",
    },
    catalogFormat: "opencode",
    modelsUrl: "https://opencode.ai/inference/v1/models",
    hideModelPattern: "(-free$|^big-pickle$)",
    sessionHeader: "x-opencode-session",
    enabled: false,
    isFallback: true,
    priority: 10,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrls: { "openai-chat-completions": "https://openrouter.ai/api/v1" },
    catalogFormat: "openai",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    hideModelPattern: null,
    sessionHeader: null,
    enabled: false,
    isFallback: true,
    priority: 20,
  },
  custom: {
    id: "",
    displayName: "",
    baseUrls: { "openai-chat-completions": "" },
    catalogFormat: "openai",
    modelsUrl: "",
    hideModelPattern: null,
    sessionHeader: null,
    enabled: false,
    isFallback: false,
    priority: 50,
  },
};

export function ProviderForm({ initial }: { initial?: ProviderFormValue }) {
  const t = useTranslations("adminModels");
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProviderAction, {});
  const [value, setValue] = useState<ProviderFormValue>(initial ?? PRESETS["opencode-go"]!);
  return (
    <form action={action} className="grid gap-3" key={value.id + value.displayName}>
      {!initial ? (
        <label className="grid gap-1 text-[13px] max-w-xs">
          <span className="text-fg-muted">{t("preset")}</span>
          <select className={input} defaultValue="opencode-go" onChange={(e) => setValue(PRESETS[e.target.value]!)}>
            <option value="opencode-go">OpenCode Go</option>
            <option value="opencode-zen">OpenCode Zen</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
          </select>
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-muted">{t("id")}</span>
          <input name="id" defaultValue={value.id} readOnly={Boolean(initial)} required pattern="[a-z0-9][a-z0-9\-]{1,40}" dir="ltr" className={`${input} font-mono`} />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-muted">{t("name")}</span>
          <input name="displayName" defaultValue={value.displayName} required maxLength={80} className={input} />
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] text-fg-muted">{t("baseUrls")}</legend>
        {API_TYPES.map((type) => (
          <label key={type} className="grid gap-1 text-[12px] sm:grid-cols-[13rem_1fr] sm:items-center">
            <span className="font-mono text-fg-subtle" dir="ltr">{type}</span>
            <input name={`baseUrl:${type}`} type="url" defaultValue={value.baseUrls[type] ?? ""} placeholder="https://…" dir="ltr" className={`${input} font-mono`} />
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-muted">{t("format")}</span>
          <select name="catalogFormat" defaultValue={value.catalogFormat} className={input}>
            <option value="opencode">OpenCode</option>
            <option value="openai">OpenAI / OpenRouter</option>
            <option value="manual">manual</option>
          </select>
        </label>
        <label className="grid gap-1 text-[13px] sm:col-span-2">
          <span className="text-fg-muted">{t("modelsUrl")}</span>
          <input name="modelsUrl" type="url" defaultValue={value.modelsUrl ?? ""} dir="ltr" className={`${input} font-mono`} />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-muted">{t("hidePattern")}</span>
          <input name="hideModelPattern" defaultValue={value.hideModelPattern ?? ""} dir="ltr" className={`${input} font-mono`} />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-muted">{t("sessionHeader")}</span>
          <input name="sessionHeader" defaultValue={value.sessionHeader ?? ""} dir="ltr" className={`${input} font-mono`} />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-muted">{t("priority")}</span>
          <input name="priority" type="number" min={0} max={1000} defaultValue={value.priority} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-[14px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={value.enabled} className="size-4" /> {t("enabled")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isFallback" defaultChecked={value.isFallback} className="size-4" /> {t("fallback")}
        </label>
        <button type="submit" className={button} disabled={pending}>
          {t("save")}
        </button>
        {state.ok ? <span role="status" className="text-[13px] text-success">✓ {t("saved")}</span> : null}
        {state.error ? <span role="alert" className="text-[13px] text-danger">{state.error}</span> : null}
      </div>
    </form>
  );
}

export function SyncProviderButton({ providerId }: { providerId: string }) {
  const t = useTranslations("adminModels");
  const [state, action, pending] = useActionState<ActionState, FormData>(syncProviderAction, {});
  const r = state.report;
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="providerId" value={providerId} />
      <button type="submit" className={secondary} disabled={pending}>
        {pending ? t("syncing") : t("syncNow")}
      </button>
      {state.error ? <p role="alert" className="text-[13px] text-danger">{state.error}</p> : null}
      {r ? (
        <div role="status" className="grid gap-1 rounded-sm border border-border bg-surface-2 p-3 text-[13px]">
          <p>
            {t("reportAdded")}: <b>{r.added.length}</b> · {t("reportUpdated")}: <b>{r.updated}</b> · {t("reportHidden")}:{" "}
            <b>{r.hidden.length}</b> · {t("reportRetired")}: <b>{r.retired.length}</b> · {t("reportRestored")}: <b>{r.restored.length}</b> ·{" "}
            {t("reportSkipped")}: <b>{r.skipped.length}</b>
          </p>
          {r.added.length ? <p dir="ltr" className="font-mono text-[12px] text-fg-muted">+ {r.added.join(", ")}</p> : null}
          {r.retired.length ? <p dir="ltr" className="font-mono text-[12px] text-danger">− {r.retired.join(", ")}</p> : null}
          {r.costChanged.length ? (
            <p className="text-warning">
              {t("reportCostChanged")}:{" "}
              <span dir="ltr" className="font-mono text-[12px]">{r.costChanged.map((c) => c.id).join(", ")}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export interface PlanFormValue {
  id: string;
  nameEn: string;
  nameAr: string;
  priceCents: number;
  currency: string;
  creditsPerPeriod: number;
  rpmLimit: number;
  maxConcurrentStreams: number;
  maxKeys: number;
  maxDevices: number;
  maxOutputTokens: number | null;
  isPublic: boolean;
  sortOrder: number;
  fallbackEnabled: boolean;
}

export function PlanForm({ plan }: { plan: PlanFormValue }) {
  const t = useTranslations("adminModels");
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePlanAction, {});
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="grid gap-1 text-[13px]">
      <span className="text-fg-muted">{label}</span>
      <input name={name} className={input} {...props} />
    </label>
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={plan.id} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("nameEn", t("nameEn"), { defaultValue: plan.nameEn, required: true, maxLength: 60 })}
        {field("nameAr", t("nameAr"), { defaultValue: plan.nameAr, required: true, maxLength: 60 })}
        {field("price", t("planPrice"), { type: "number", min: 0, step: "0.01", defaultValue: (plan.priceCents / 100).toFixed(2), dir: "ltr" })}
        {field("currency", t("planCurrency"), { defaultValue: plan.currency, maxLength: 3, required: true, dir: "ltr" })}
        {field("creditsPerPeriod", t("planCredits"), { type: "number", min: 0, defaultValue: plan.creditsPerPeriod, dir: "ltr" })}
        {field("rpmLimit", t("planRpm"), { type: "number", min: 1, defaultValue: plan.rpmLimit, dir: "ltr" })}
        {field("maxConcurrentStreams", t("planStreams"), { type: "number", min: 1, defaultValue: plan.maxConcurrentStreams, dir: "ltr" })}
        {field("maxKeys", t("planKeys"), { type: "number", min: 0, defaultValue: plan.maxKeys, dir: "ltr" })}
        {field("maxDevices", t("planDevices"), { type: "number", min: 1, defaultValue: plan.maxDevices, dir: "ltr" })}
        {field("maxOutputTokens", t("planMaxOut"), { type: "number", min: 1, defaultValue: plan.maxOutputTokens ?? "", dir: "ltr" })}
        {field("sortOrder", t("planOrder"), { type: "number", min: 0, defaultValue: plan.sortOrder, dir: "ltr" })}
      </div>
      <div className="flex flex-wrap items-center gap-5 text-[14px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isPublic" defaultChecked={plan.isPublic} className="size-4" /> {t("planPublic")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="fallbackEnabled" defaultChecked={plan.fallbackEnabled} className="size-4" /> {t("planFallback")}
        </label>
        <button type="submit" className={button} disabled={pending}>
          {t("save")}
        </button>
        {state.ok ? <span role="status" className="text-[13px] text-success">✓ {t("saved")}</span> : null}
        {state.error ? <span role="alert" className="text-[13px] text-danger">{state.error}</span> : null}
      </div>
    </form>
  );
}
