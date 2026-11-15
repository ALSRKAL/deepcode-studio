/**
 * Brand mark — "the split D" (docs/brand/identity.md).
 *
 * A geometric D whose stem is the cyan split line from the product's signature
 * move: Arabic interface on one side, LTR code on the other. It is deliberately
 * two colours and one shape so it survives 16 px favicons and monochrome use.
 *
 * Brand colours are fixed (not theme tokens): the mark is the same on light and
 * dark surfaces, and the adjacent wordmark supplies the accessible name.
 */
export function BrandMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="#111827" />
      <path
        d="M10.5 9H17a7 7 0 0 1 0 14h-6.5"
        fill="none"
        stroke="#F8FAFC"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.5 9v14" stroke="#22D3EE" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Wordmark: brand name in text, "Studio" as the quiet qualifier. */
export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      DeepCode <span className="font-normal text-fg-muted">Studio</span>
    </span>
  );
}
