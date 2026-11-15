"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  uploadSkillAction,
  publishSkillAction,
  unpublishSkillAction,
  saveMcpPresetAction,
  publishMcpPresetAction,
  unpublishMcpPresetAction,
  type MarketplaceState,
} from "@/actions/marketplace";

const input =
  "h-10 rounded-sm border border-border bg-surface px-3 text-[14px] placeholder:text-fg-subtle disabled:opacity-50";
const label = "grid gap-1.5 text-[14px]";

function Feedback({ state }: { state: MarketplaceState }) {
  const t = useTranslations("admin");
  if (state.error === "executables_need_confirmation") {
    return <p role="alert" className="text-[13px] text-warning">{t("archiveExecutables")}</p>;
  }
  if (state.error) return <p role="alert" className="text-[13px] text-danger">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-[13px] text-success">✓</p>;
  return null;
}

export function MarketplaceForms() {
  const t = useTranslations("admin");
  const c = useTranslations("common");
  const [upload, uploadAction] = useActionState<MarketplaceState, FormData>(uploadSkillAction, {});
  const [skillPub, skillPubAction] = useActionState<MarketplaceState, FormData>(publishSkillAction, {});
  const [skillUn, skillUnAction] = useActionState<MarketplaceState, FormData>(unpublishSkillAction, {});
  const [preset, presetAction] = useActionState<MarketplaceState, FormData>(saveMcpPresetAction, {});
  const [presetPub, presetPubAction] = useActionState<MarketplaceState, FormData>(publishMcpPresetAction, {});
  const [presetUn, presetUnAction] = useActionState<MarketplaceState, FormData>(unpublishMcpPresetAction, {});

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="font-medium mb-3">{t("uploadSkill")}</p>
        <form action={uploadAction} className="grid gap-3">
          <Feedback state={upload} />
          <label className={label}>
            <span className="text-fg-muted">slug</span>
            <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" className={input} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              <span className="text-fg-muted">name (en)</span>
              <input name="nameEn" required className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">الاسم (ar)</span>
              <input name="nameAr" required className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">description (en)</span>
              <input name="descriptionEn" required className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">الوصف (ar)</span>
              <input name="descriptionAr" required className={input} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              <span className="text-fg-muted">{t("version")}</span>
              <input name="version" required defaultValue="1.0.0" className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">{t("minTier")}</span>
              <select name="minTier" className={input} defaultValue="free">
                <option value="free">free</option>
                <option value="starter">starter</option>
                <option value="pro">pro</option>
                <option value="team">team</option>
              </select>
            </label>
          </div>
          <label className={label}>
            <span className="text-fg-muted">archive (.tar)</span>
            <input name="archive" type="file" accept=".tar,.tar.zst,.zip" required className={input} />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            <input name="hasExecutables" type="checkbox" value="confirmed" />
            {t("archiveExecutables")}
          </label>
          <button type="submit" className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover justify-self-start">
            {t("uploadSkill")}
          </button>
        </form>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <form action={skillPubAction} className="flex gap-2">
            <input name="slug" placeholder="slug" className={`${input} grow`} required />
            <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
              {t("publish")}
            </button>
          </form>
          <form action={skillUnAction} className="flex gap-2">
            <input name="slug" placeholder="slug" className={`${input} grow`} required />
            <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
              {t("unpublish")}
            </button>
          </form>
          <Feedback state={skillPub.ok ? skillPub : skillUn} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="font-medium mb-3">{t("marketplaceMcp")}</p>
        <form action={presetAction} className="grid gap-3">
          <Feedback state={preset} />
          <label className={label}>
            <span className="text-fg-muted">slug</span>
            <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" className={input} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              <span className="text-fg-muted">name (en)</span>
              <input name="nameEn" required className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">الاسم (ar)</span>
              <input name="nameAr" required className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">description (en)</span>
              <input name="descriptionEn" required className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">الوصف (ar)</span>
              <input name="descriptionAr" required className={input} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>
              <span className="text-fg-muted">{t("version")}</span>
              <input name="version" required defaultValue="1.0.0" className={input} />
            </label>
            <label className={label}>
              <span className="text-fg-muted">{t("minTier")}</span>
              <select name="minTier" className={input} defaultValue="free">
                <option value="free">free</option>
                <option value="starter">starter</option>
                <option value="pro">pro</option>
                <option value="team">team</option>
              </select>
            </label>
            <label className={label}>
              <span className="text-fg-muted">{t("mcpTransport")}</span>
              <select name="transport" className={input} defaultValue="stdio">
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="http">http</option>
              </select>
            </label>
          </div>
          <label className={label}>
            <span className="text-fg-muted">{t("mcpCommand")}</span>
            <input name="command" dir="ltr" className={`${input} font-mono`} placeholder="command (stdio)" />
          </label>
          <label className={label}>
            <span className="text-fg-muted">args</span>
            <input name="args" dir="ltr" className={`${input} font-mono`} placeholder="--flag value" />
          </label>
          <label className={label}>
            <span className="text-fg-muted">url (sse/http)</span>
            <input name="url" dir="ltr" className={`${input} font-mono`} />
          </label>
          <label className={label}>
            <span className="text-fg-muted">{t("mcpEnv")}</span>
            <input name="envNames" dir="ltr" className={`${input} font-mono`} placeholder="API_KEY, API_SECRET" />
          </label>
          <button type="submit" className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover justify-self-start">
            {c("save")}
          </button>
        </form>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <form action={presetPubAction} className="flex gap-2">
            <input name="slug" placeholder="slug" className={`${input} grow`} required />
            <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
              {t("publish")}
            </button>
          </form>
          <form action={presetUnAction} className="flex gap-2">
            <input name="slug" placeholder="slug" className={`${input} grow`} required />
            <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
              {t("unpublish")}
            </button>
          </form>
          <Feedback state={presetPub.ok ? presetPub : presetUn} />
        </div>
      </div>
    </div>
  );
}
