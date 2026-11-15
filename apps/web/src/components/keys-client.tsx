"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { createApiKeyAction, rotateApiKeyAction, revokeApiKeyAction, type KeyActionState } from "@/actions/keys";
import { CopyButton } from "@/components/ui/client";
import { LtrIsland } from "@/components/ltr-island";

/** Key creation with the shown-once moment (doc 00 ADR-006, W-05). */
export function CreateKeyForm({ disabled }: { disabled?: boolean }) {
  const t = useTranslations("keys");
  const c = useTranslations("common");
  const [state, action] = useActionState<KeyActionState, FormData>(createApiKeyAction, {});
  const [saved, setSaved] = useState(false);

  if (state.key && !saved) {
    return (
      <div role="alert" className="rounded-lg border border-primary/40 bg-surface p-4">
        <p className="font-medium">{t("shownOnceTitle")}</p>
        <p className="mt-1 text-[13px] text-fg-muted">{t("shownOnceBody")}</p>
        <div className="mt-3 flex items-center gap-2">
          <LtrIsland className="block max-w-full overflow-x-auto rounded-sm border border-border bg-bg px-3 py-2 text-[13px]" tabIndex={0}>
            {state.key}
          </LtrIsland>
          <CopyButton value={state.key} label={c("copy")} />
        </div>
        <button
          type="button"
          onClick={() => setSaved(true)}
          className="mt-3 inline-flex h-9 items-center rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover"
        >
          {t("iSavedIt")}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {state.error ? (
        <p role="alert" className="w-full text-[13px] text-danger">
          {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t("errors.invalid_request")}
        </p>
      ) : null}
      <label className="grid gap-1.5 text-[14px] grow">
        <span className="text-fg-muted">{t("name")}</span>
        <input
          name="name"
          required
          maxLength={100}
          placeholder={t("namePlaceholder")}
          disabled={disabled}
          className="h-10 rounded-sm border border-border bg-surface px-3 text-[14px] placeholder:text-fg-subtle disabled:opacity-50"
        />
      </label>
      <button
        type="submit"
        disabled={disabled}
        className="h-10 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover disabled:opacity-50"
      >
        {t("create")}
      </button>
    </form>
  );
}

export function RotateKeyButton({ keyId }: { keyId: string }) {
  const t = useTranslations("keys");
  const c = useTranslations("common");
  const [state, action] = useActionState<KeyActionState, FormData>(rotateApiKeyAction, {});
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  if (state.key && !saved) {
    return (
      <div role="alert" className="fixed inset-0 z-50 grid place-content-center bg-black/60 p-4">
        <div className="rounded-lg border border-border bg-surface p-6 max-w-lg">
          <p className="font-medium">{t("shownOnceTitle")}</p>
          <p className="mt-1 text-[13px] text-fg-muted">{t("shownOnceBody")}</p>
          <div className="mt-3 flex items-center gap-2">
            <LtrIsland className="block max-w-full overflow-x-auto rounded-sm border border-border bg-bg px-3 py-2 text-[13px]" tabIndex={0}>
              {state.key}
            </LtrIsland>
            <CopyButton value={state.key} label={c("copy")} />
          </div>
          <button
            type="button"
            onClick={() => setSaved(true)}
            className="mt-3 inline-flex h-9 items-center rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover"
          >
            {t("iSavedIt")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="keyId" value={keyId} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-[13px] text-fg-muted hover:text-fg hover:bg-surface-2"
      >
        {t("rotate")}
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-content-center bg-black/60 p-4">
          <div className="rounded-lg border border-border bg-surface p-6 max-w-lg">
            <p className="font-medium">{t("rotate")}</p>
            <p className="mt-1 text-[13px] text-fg-muted">{t("rotateBody")}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover"
              >
                {t("rotate")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-sm border border-border px-4 text-[14px] text-fg-muted hover:text-fg"
              >
                {c("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function RevokeKeyButton({ keyId }: { keyId: string }) {
  const t = useTranslations("keys");
  const c = useTranslations("common");
  const [state, action] = useActionState<{ error?: string; ok?: boolean }, FormData>(revokeApiKeyAction, {});
  const [open, setOpen] = useState(false);
  return (
    <form action={action}>
      <input type="hidden" name="keyId" value={keyId} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-sm border border-danger/40 px-3 text-[13px] text-danger hover:bg-danger/10"
      >
        {t("revoke")}
      </button>
      {state.error ? <p role="alert" className="text-[12px] text-danger">{t(`errors.${state.error}`)}</p> : null}
      {open ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-content-center bg-black/60 p-4">
          <div className="rounded-lg border border-border bg-surface p-6 max-w-lg">
            <p className="font-medium">{t("revoke")}</p>
            <p className="mt-1 text-[13px] text-fg-muted">{t("revokeConfirm")}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                onClick={() => setOpen(false)}
                className="h-9 rounded-sm border border-danger/40 px-4 text-[14px] text-danger hover:bg-danger/10"
              >
                {t("revoke")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-sm border border-border px-4 text-[14px] text-fg-muted hover:text-fg"
              >
                {c("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
