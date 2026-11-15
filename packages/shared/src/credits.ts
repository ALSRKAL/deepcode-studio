/**
 * Credit arithmetic (ADR-004). Prices are integer credits per million tokens;
 * 1 credit = USD 0.000001, so $15 / MTok is 15_000_000 credits / MTok.
 *
 * Magnitudes stay far below Number.MAX_SAFE_INTEGER: 2M tokens x 1e9 credits/MTok
 * is 2e15, which is still exact in a double.
 */

export interface TokenUsage {
  /** Total input tokens, INCLUDING cached input. */
  input: number;
  /** Portion of `input` served from cache. */
  cachedInput: number;
  /** Total output tokens, INCLUDING reasoning tokens. */
  output: number;
  /** Portion of `output` that was reasoning; informational, billed as output. */
  reasoning: number;
}

export interface ModelPrice {
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}

export const ZERO_USAGE: Readonly<TokenUsage> = Object.freeze({
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
});

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Clamp and normalise a usage record so pricing never sees negative or fractional values. */
export function normalizeUsage(usage: TokenUsage): TokenUsage {
  const input = nonNegativeInt(usage.input);
  const output = nonNegativeInt(usage.output);
  return {
    input,
    cachedInput: Math.min(nonNegativeInt(usage.cachedInput), input),
    output,
    reasoning: Math.min(nonNegativeInt(usage.reasoning), output),
  };
}

export function computeCredits(usage: TokenUsage, price: ModelPrice): number {
  const u = normalizeUsage(usage);
  const microCredits =
    (u.input - u.cachedInput) * price.inputPerMTok +
    u.cachedInput * price.cachedInputPerMTok +
    u.output * price.outputPerMTok;
  return Math.ceil(microCredits / 1_000_000);
}

/** Percentage used with one decimal, clamped to [0, 100]. */
export function percentUsed(used: number, limit: number): number {
  if (limit <= 0) return 100;
  const pct = (used / limit) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

/** Whole days until `expiresAt`, rounded up, never negative. */
export function daysLeft(expiresAt: Date, now: Date): number {
  const ms = expiresAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
