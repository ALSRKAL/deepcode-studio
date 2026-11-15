/** Code, keys, URLs, model ids and commands never mirror (docs/plan/03 §1.9). */
export function LtrIsland({
  children,
  className = "",
  as: Tag = "span",
  tabIndex,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "div" | "code" | "pre" | "kbd";
  /** Set 0 when the island is a scrollable region so keyboard users can scroll it. */
  tabIndex?: number;
}) {
  return (
    <Tag className={`ltr-island font-mono ${className}`} dir="ltr" tabIndex={tabIndex}>
      {children}
    </Tag>
  );
}

/** Per-paragraph auto direction for chat-like content. */
export function AutoDir({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="auto" className={className}>
      {children}
    </span>
  );
}
