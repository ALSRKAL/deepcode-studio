import Link from "next/link";

/** Locale-aware link: keeps the /[locale] prefix without repeating it at call sites. */
export function LocaleLink({
  locale,
  href,
  children,
  className,
}: {
  locale: string;
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={`/${locale}${href}`} className={className}>
      {children}
    </Link>
  );
}
