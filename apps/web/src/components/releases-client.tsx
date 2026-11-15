"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { registerReleaseAction, publishReleaseAction, type ReleaseState } from "@/actions/releases";

const input =
  "h-10 rounded-sm border border-border bg-surface px-3 text-[14px] placeholder:text-fg-subtle disabled:opacity-50";
const label = "grid gap-1.5 text-[14px]";

export function ReleaseForms() {
  const t = useTranslations("admin");
  const [reg, regAction] = useActionState<ReleaseState, FormData>(registerReleaseAction, {});
  const [pub, pubAction] = useActionState<ReleaseState, FormData>(publishReleaseAction, {});
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <p className="font-medium mb-3">{t("registerRelease")}</p>
      <form action={regAction} className="grid gap-3 max-w-2xl">
        {reg.error ? <p role="alert" className="text-[13px] text-danger">{reg.error}</p> : null}
        {reg.ok ? <p role="status" className="text-[13px] text-success">✓</p> : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className={label}>
            <span className="text-fg-muted">{t("version")}</span>
            <input name="version" required placeholder="1.0.0" className={`${input} font-mono`} />
          </label>
          <label className={label}>
            <span className="text-fg-muted">{t("channel")}</span>
            <select name="channel" className={input} defaultValue="stable">
              <option value="stable">stable</option>
              <option value="preview">preview</option>
            </select>
          </label>
          <label className={label}>
            <span className="text-fg-muted">{t("platform")}</span>
            <select name="platform" className={input} defaultValue="linux">
              <option value="win">win</option>
              <option value="mac">mac</option>
              <option value="linux">linux</option>
            </select>
          </label>
          <label className={label}>
            <span className="text-fg-muted">{t("arch")}</span>
            <select name="arch" className={input} defaultValue="x64">
              <option value="x64">x64</option>
              <option value="arm64">arm64</option>
            </select>
          </label>
          <label className={label}>
            <span className="text-fg-muted">file kind</span>
            <select name="fileKind" className={input} defaultValue="AppImage">
              <option value="exe">exe</option>
              <option value="dmg">dmg</option>
              <option value="zip">zip</option>
              <option value="AppImage">AppImage</option>
              <option value="deb">deb</option>
            </select>
          </label>
          <label className={label}>
            <span className="text-fg-muted">{t("size")}</span>
            <input name="sizeBytes" type="number" min={0} required className={input} />
          </label>
          <label className={`${label} col-span-2`}>
            <span className="text-fg-muted">{t("url")}</span>
            <input name="url" required dir="ltr" className={`${input} font-mono`} placeholder="https://cdn.example/…/.AppImage" />
          </label>
          <label className={`${label} col-span-2`}>
            <span className="text-fg-muted">{t("sha")}</span>
            <input name="sha256" required pattern="[0-9a-f]{64}" dir="ltr" className={`${input} font-mono`} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            <span className="text-fg-muted">{t("notes")} (en)</span>
            <input name="notesEn" className={input} />
          </label>
          <label className={label}>
            <span className="text-fg-muted">{t("notes")} (ar)</span>
            <input name="notesAr" className={input} />
          </label>
        </div>
        <button type="submit" className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover justify-self-start">
          {t("registerRelease")}
        </button>
      </form>
      <form action={pubAction} className="mt-4 flex gap-2 max-w-md">
        <input name="id" placeholder="release uuid" required className={`${input} grow font-mono`} />
        <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
          {t("publishRelease")}
        </button>
        {pub.error ? <p className="text-[13px] text-danger">{pub.error}</p> : null}
        {pub.ok ? <p className="text-[13px] text-success">✓</p> : null}
      </form>
    </div>
  );
}
