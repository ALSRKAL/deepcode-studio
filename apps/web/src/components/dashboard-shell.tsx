"use client";

import { signOutAction } from "@/actions/auth";

export function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-[13px] text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors duration-200 ease-out"
        aria-label={label}
      >
        {label}
      </button>
    </form>
  );
}
