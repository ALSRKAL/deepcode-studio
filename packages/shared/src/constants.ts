/**
 * Constants shared by the gateway, the web portal and (via a vendored copy) the
 * desktop app. This entry point must stay free of Node built-ins so it can be
 * bundled into browser and Electron renderer code.
 */

export const VIRTUAL_KEY_PREFIX = "sk-dc-";
/** Base62 characters after the prefix: 32 random bytes encode to 43 base62 chars. */
export const VIRTUAL_KEY_BODY_LENGTH = 43;
export const DEEP_LINK_SCHEME = "deepcodestudio";

/** Response headers set by the gateway on every authenticated response. */
export const USAGE_HEADERS = {
  creditsRemaining: "X-Credits-Remaining",
  usagePercentage: "X-Usage-Percentage",
  subscriptionExpires: "X-Subscription-Expires",
  planName: "X-Plan-Name",
  requestId: "X-Request-Id",
  rateLimitLimit: "X-RateLimit-Limit",
  rateLimitRemaining: "X-RateLimit-Remaining",
  rateLimitReset: "X-RateLimit-Reset",
} as const;

/** Prefix of the SSE comment line that carries the exact post-request balance. */
export const STREAM_USAGE_COMMENT_PREFIX = ": deepcode-usage ";

/** 1 credit = USD 0.000001 of list-price cost (ADR-004). */
export const CREDITS_PER_USD = 1_000_000;

export const PLAN_TIERS = ["free", "starter", "pro", "team"] as const;
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export const UPSTREAM_API_TYPES = [
  "openai-chat-completions",
  "anthropic-messages",
  "openai-responses",
  "google-generative-ai",
] as const;
export const LOCK_REASONS = ["quota_exhausted", "expired", "suspended", "payment_failed"] as const;
