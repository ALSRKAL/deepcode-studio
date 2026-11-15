/** Price display: Western digits in both locales (docs/plan/03 §1.5), symbol by currency. */
const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", SAR: "SAR " };

export function formatPrice(amountMinor: number, currency: string): string {
  const value = (amountMinor / 100).toFixed(2);
  const symbol = SYMBOLS[currency.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${currency.toUpperCase()} ${value}`;
}
