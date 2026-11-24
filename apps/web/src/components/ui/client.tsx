"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./button";

/** Submit button with the pending state (docs/plan/03 §1.8 state matrix). */
export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className = "",
  pendingLabel,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${buttonClass(variant, size)} ${className}`}
    >
      {pending ? (pendingLabel ?? "…") : children}
    </button>
  );
}

export function CopyButton({ value, label, copiedLabel = "Copied" }: { value: string; label: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex h-11 shrink-0 items-center rounded-sm border border-border px-3 text-[13px] text-fg-muted transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable — the value stays selectable
        }
      }}
    >
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
      {copied ? <span aria-hidden="true" className="text-success">✓</span> : null}
      {label}
    </button>
  );
}
