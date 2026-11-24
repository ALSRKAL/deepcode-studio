/** Price display: Western digits in both locales (docs/plan/03 §1.5), symbol by currency. */
const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", SAR: "SAR " };

export function formatPrice(amountMinor: number, currency: string): string {
  // Whole amounts read as ₹1,999, not ₹1999.00; paise only when there are any.
  const whole = amountMinor % 100 === 0;
  const value = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  const symbol = SYMBOLS[currency.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${currency.toUpperCase()} ${value}`;
}
