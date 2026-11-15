"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { signInAction, signUpAction, requestPasswordResetAction } from "@/actions/auth";

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
