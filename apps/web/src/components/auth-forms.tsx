"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import {
  signInAction,
  signUpAction,
  requestPasswordResetAction,
  googleSignInAction,
  verifySignInTwoFactorAction,
} from "@/actions/auth";

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  min,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  min?: number;
}) {
  const { pending } = useFormStatus();
  return (
    <label className="grid gap-1.5 text-[14px]">
      <span className="text-fg-muted">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={min}
        disabled={pending}
        className="h-10 rounded-sm border border-border bg-surface px-3 text-[14px] text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
      />
    </label>
  );
}

/** `returnTo` is a path only, validated server-side (no open redirect, W-01/§3.2). */
export function SignInForm({ returnTo }: { returnTo?: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState(signInAction, {});
  return (
    <form action={action} className="grid gap-4">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {state.error ? (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <Field label={t("email")} name="email" type="email" autoComplete="email" />
      <Field label={t("password")} name="password" type="password" autoComplete="current-password" />
      <AuthSubmit>{t("submitSignIn")}</AuthSubmit>
    </form>
  );
}

/** Code from the authenticator app (6 digits) or one of the backup codes. */
export function TwoFactorSignInForm({ returnTo }: { returnTo?: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState(verifySignInTwoFactorAction, {});
  return (
    <form action={action} className="grid gap-4">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {state.error ? (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <label className="grid gap-1.5 text-[14px]">
        <span className="text-fg-muted">{t("twoFactorCode")}</span>
        <input
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={32}
          dir="ltr"
          className="h-10 rounded-sm border border-border bg-surface px-3 font-mono text-[16px] tracking-widest text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>
      <label className="flex items-center gap-2 text-[14px] text-fg-muted">
        <input type="checkbox" name="trustDevice" className="size-4 accent-[var(--color-primary)]" />
        {t("twoFactorTrust")}
      </label>
      <AuthSubmit>{t("twoFactorSubmit")}</AuthSubmit>
    </form>
  );
}

function GoogleSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-border bg-surface px-4 text-[14px] font-medium text-fg hover:bg-fg/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px] shrink-0">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

/** "Continue with Google" + an "or" divider; rendered only when Google OAuth is configured. */
export function GoogleSignIn({ locale, returnTo }: { locale: string; returnTo?: string }) {
  const t = useTranslations("auth");
  return (
    <div className="grid gap-4">
      <form action={googleSignInAction} className="grid">
        <input type="hidden" name="locale" value={locale} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        <GoogleSubmit label={t("google")} />
      </form>
      <div className="flex items-center gap-3 text-[13px] text-fg-subtle" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

export function SignUpForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(signUpAction, {});
  return (
    <form action={action} className="grid gap-4">
      {state.error ? (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <Field label={t("name")} name="name" autoComplete="name" />
      <Field label={t("email")} name="email" type="email" autoComplete="email" />
      <Field label={t("password")} name="password" type="password" autoComplete="new-password" min={10} />
      <AuthSubmit>{t("submitSignUp")}</AuthSubmit>
    </form>
  );
}

export function ForgotForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(requestPasswordResetAction, {});
  return (
    <form action={action} className="grid gap-4">
      <Field label={t("email")} name="email" type="email" autoComplete="email" />
      <AuthSubmit>{t("forgotTitle")}</AuthSubmit>
      {state.error ? <p role="alert">{t("errors.invalid_input")}</p> : null}
    </form>
  );
}

function AuthSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="h-10 rounded-sm bg-primary text-primary-fg font-medium hover:bg-primary-hover transition-colors duration-200 ease-out disabled:opacity-50"
    >
      {pending ? "…" : children}
    </button>
  );
}
