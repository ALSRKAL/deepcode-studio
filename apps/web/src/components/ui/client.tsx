"use client";

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

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-[13px] text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors duration-200 ease-out"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          const btn = document.getElementById(`copied-${hash(value)}`);
          if (btn) {
            btn.hidden = false;
            setTimeout(() => (btn.hidden = true), 1500);
          }
        } catch {
          // clipboard unavailable — the value stays selectable
        }
      }}
    >
      <span id={`copied-${hash(value)}`} hidden className="text-success">
        ✓{" "}
      </span>
      {label}
    </button>
  );
}

function hash(v: string): string {
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
