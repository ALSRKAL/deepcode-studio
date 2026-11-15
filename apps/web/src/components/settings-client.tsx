"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  updateProfileAction,
  changePasswordAction,
  enableTwoFactorAction,
  verifyTwoFactorAction,
  disableTwoFactorAction,
  deleteAccountAction,
  type SettingsState,
} from "@/actions/settings";
import { LtrIsland } from "@/components/ltr-island";

function Feedback({ state }: { state: SettingsState }) {
  const t = useTranslations("settings");
  if (state.ok) return <p role="status" className="text-[13px] text-success">✓ {t("saved")}</p>;
  if (state.error) return <p role="alert" className="text-[13px] text-danger">{state.error}</p>;
  return null;
}

const input =
  "h-10 rounded-sm border border-border bg-surface px-3 text-[14px] placeholder:text-fg-subtle disabled:opacity-50";

export function SettingsClient({
  initialName,
  locale,
  twoFactorEnabled,
  hasPassword,
}: {
  initialName: string;
  locale: string;
  twoFactorEnabled: boolean;
  twofaUri: string | null;
  /** Google-only accounts have no password: hide the password fields. */
  hasPassword: boolean;
}) {
  const t = useTranslations("settings");
  const c = useTranslations("common");
  const [profile, profileAction] = useActionState(updateProfileAction, {});
  const [pw, pwAction] = useActionState(changePasswordAction, {});
  const [enable, enableAction] = useActionState(enableTwoFactorAction, {});
  const [verify, verifyAction] = useActionState(verifyTwoFactorAction, {});
  const [disable, disableAction] = useActionState(disableTwoFactorAction, {});
  const [del, delAction] = useActionState(deleteAccountAction, {});

  return (
    <div className="grid gap-8">
      <form action={profileAction} className="grid gap-3 max-w-sm">
        <label className="grid gap-1.5 text-[14px]">
          <span className="text-fg-muted">{t("name")}</span>
          <input name="name" defaultValue={initialName} className={input} required maxLength={100} />
        </label>
        <label className="grid gap-1.5 text-[14px]">
          <span className="text-fg-muted">{t("locale")}</span>
          <select name="locale" defaultValue={locale} className={input}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <Feedback state={profile} />
        <button type="submit" className="h-9 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover justify-self-start">
          {c("save")}
        </button>
      </form>

      {hasPassword ? (
      <form action={pwAction} className="grid gap-3 max-w-sm">
        <p className="font-medium">{t("password")}</p>
        <input name="currentPassword" type="password" placeholder="●●●●●●●●" className={input} required autoComplete="current-password" />
        <input name="newPassword" type="password" placeholder={t("changePassword")} className={input} required minLength={10} autoComplete="new-password" />
        <Feedback state={pw} />
        <button type="submit" className="h-9 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2 justify-self-start">
          {t("changePassword")}
        </button>
      </form>
      ) : null}

      <div className="grid gap-3 max-w-md">
        <p className="font-medium">{t("twofa")}</p>
        {!twoFactorEnabled ? (
          <>
            <form action={enableAction} className="flex items-end gap-2">
              {hasPassword ? (
              <input name="password" type="password" placeholder="●●●●●●●●" className={`${input} grow`} required autoComplete="current-password" />
            ) : null}
              <button type="submit" className="h-10 rounded-sm border border-border px-4 text-[14px] hover:bg-surface-2">
                {t("twofaEnable")}
              </button>
            </form>
            {enable.totpUri ? (
              <div className="grid gap-2 rounded-lg border border-primary/40 bg-surface p-4">
                <p className="text-[13px] text-fg-muted">{t("twofaScan")}</p>
                {enable.totpQrSvg ? (
                  <div
                    role="img"
                    aria-label={t("twofaScan")}
                    className="size-[200px] rounded-sm bg-white p-1 justify-self-start"
                    // SVG produced server-side by the qrcode library from the TOTP URI.
                    dangerouslySetInnerHTML={{ __html: enable.totpQrSvg }}
                  />
                ) : null}
                <LtrIsland className="block overflow-x-auto rounded-sm border border-border bg-bg px-3 py-2 font-mono text-[12px]" as="pre" tabIndex={0}>
                  {enable.totpSecret ?? enable.totpUri}
                </LtrIsland>
                <form action={verifyAction} className="flex items-end gap-2">
                  <input name="code" inputMode="numeric" pattern="[0-9]*" placeholder={t("twofaCode")} className={`${input} grow font-mono`} required />
                  <button type="submit" className="h-10 rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover">
                    {c("confirm")}
                  </button>
                </form>
              </div>
            ) : null}
            <Feedback state={verify.ok ? verify : enable} />
          </>
        ) : (
          <form action={disableAction} className="flex items-end gap-2">
            {hasPassword ? (
              <input name="password" type="password" placeholder="●●●●●●●●" className={`${input} grow`} required autoComplete="current-password" />
            ) : null}
            <button type="submit" className="h-10 rounded-sm border border-danger/40 px-4 text-[14px] text-danger hover:bg-danger/10">
              {t("twofaDisable")}
            </button>
            <Feedback state={disable} />
          </form>
        )}
      </div>

      <form action={delAction} className="grid gap-3 max-w-md rounded-lg border border-danger/40 p-4">
        <p className="font-medium text-danger">{t("deleteAccount")}</p>
        <p className="text-[13px] text-fg-muted leading-6">{t("deleteBody")}</p>
        <input name="confirm" placeholder={t("deleteConfirm")} className={input} required />
        <Feedback state={del} />
        <button type="submit" className="h-9 rounded-sm border border-danger/40 px-4 text-[14px] text-danger hover:bg-danger/10 justify-self-start">
          {t("deleteAccount")}
        </button>
      </form>
    </div>
  );
}
