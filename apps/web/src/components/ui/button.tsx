import Link from "next/link";

/** Button ranking (docs/plan/03 §1.8): one primary per view, secondary, ghost. */
export function buttonClass(
  variant: "primary" | "secondary" | "ghost" | "danger",
  size: "sm" | "md" | "lg" = "md",
): string {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-[background-color,border-color,color] duration-200 ease-out disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const sizes = size === "sm" ? "h-11 px-3 text-[13px]" : size === "lg" ? "h-12 px-5 text-[15px]" : "h-11 px-4 text-[14px]";
  const styles: Record<string, string> = {
    primary: "bg-primary text-primary-fg hover:bg-primary-hover active:brightness-95",
    secondary: "border border-border-strong text-fg hover:bg-surface-2",
    ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
  };
  return `${base} ${sizes} ${styles[variant]}`;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link href={href} className={`${buttonClass(variant, size)} ${className}`} {...rest}>
      {children}
    </Link>
  );
}
