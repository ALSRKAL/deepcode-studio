/** Price display: Western digits in both locales (docs/plan/03 §1.5), symbol by currency. */
const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", SAR: "SAR " };

export function formatPrice(amountMinor: number, currency: string): string {
  // Whole amounts read as ₹299, not ₹299.00; paise only when there are any.
  const value = amountMinor % 100 === 0 ? String(amountMinor / 100) : (amountMinor / 100).toFixed(2);
  const symbol = SYMBOLS[currency.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${currency.toUpperCase()} ${value}`;
}
