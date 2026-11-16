import { LtrIsland } from "../ltr-island";

/** One cyan rule per view. Recommended plan gets the cyan top rule, not scaling. */
export function Card({
  children,
  className = "",
  accent = false,
  scrollLabel,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  /** For a card that scrolls sideways (tables on phones): keyboard-focusable named region (WCAG 2.1.1). */
  scrollLabel?: string;
}) {
  return (
    <div
      {...(scrollLabel ? { tabIndex: 0, role: "region", "aria-label": scrollLabel } : {})}
      className={`rounded-lg border border-border bg-surface ${accent ? "border-t-2 border-t-primary" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Section heading. Sections use h2; a page's single main title passes `as="h1"`
 * so the document has a proper heading root (W-11/W-12).
 */
export function SectionTitle({
  children,
  sub,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  sub?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mb-8">
      <Tag className="text-scale-lg font-semibold">{children}</Tag>
      {sub ? <p className="mt-2 text-fg-muted text-[15px] leading-7 max-w-prose">{sub}</p> : null}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "border-border text-fg-muted",
    success: "border-success/40 text-success",
    warning: "border-warning/40 text-warning",
    danger: "border-danger/40 text-danger",
    primary: "border-primary/40 text-primary",
  };
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[12px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** role=progressbar with aria-valuenow; severity never by colour alone (§7.3). */
export function Progress({
  value,
  max = 100,
  label,
  level = "ok",
}: {
  value: number;
  max?: number;
  label: string;
  level?: "ok" | "warn" | "critical";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colors = { ok: "bg-primary", warn: "bg-warning", critical: "bg-danger" };
  const icons = { ok: "", warn: "⚠", critical: "⚠" };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full rounded-sm bg-surface-2 overflow-hidden"
    >
      <div className={`h-full ${colors[level]} transition-[width] duration-300 ease-out`} style={{ width: `${pct}%` }} />
      <span className="sr-only">
        {icons[level]} {label}
      </span>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-surface-2 ${className}`} aria-hidden="true" />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1.5 text-fg-muted text-[14px] leading-6 max-w-md mx-auto">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, retryHref }: { message: string; retryHref?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-[14px]">
      <p className="text-danger font-medium">{message}</p>
      {retryHref ? (
        <a href={retryHref} className="mt-2 inline-block text-primary underline underline-offset-2">
          Retry
        </a>
      ) : null}
    </div>
  );
}

/** Mono tabular figures, end-aligned (§1.8 tables). */
export function Num({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`tabular font-mono text-[13px] text-start ${className}`} dir="ltr">
      {children}
    </span>
  );
}

export function KeySnippet({ value, label }: { value: string; label: string }) {
  return (
    <LtrIsland className="block rounded-sm border border-border bg-bg px-3 py-2 text-[13px] text-fg-muted overflow-x-auto" as="pre" tabIndex={0}>
      {label ? `${label}` : ""}
      {value}
    </LtrIsland>
  );
}
