import { LocaleLink } from "./locale-link";
import { BrandMark, BrandWordmark } from "./brand";

/** Brand lockup shown above the auth forms (identity docs/brand/identity.md). */
export function AuthBrand({ locale }: { locale: string }) {
  return (
    <LocaleLink locale={locale} href="/" className="mx-auto flex items-center gap-2" aria-label="DeepCode Studio">
      <BrandMark size={28} />
      <BrandWordmark className="text-[16px] font-semibold tracking-[-0.01em]" />
    </LocaleLink>
  );
}
