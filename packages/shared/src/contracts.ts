import { z } from "zod";
import {
  LOCK_REASONS,
  PLAN_TIERS,
  SUBSCRIPTION_STATUSES,
  UPSTREAM_API_TYPES,
} from "./constants.js";

export const PlanTierSchema = z.enum(PLAN_TIERS);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const UpstreamApiTypeSchema = z.enum(UPSTREAM_API_TYPES);
export type UpstreamApiType = z.infer<typeof UpstreamApiTypeSchema>;

export const LockReasonSchema = z.enum(LOCK_REASONS);
export type LockReason = z.infer<typeof LockReasonSchema>;

const isoDate = z.iso.datetime({ offset: true });

/** GET /v1/subscription/status — docs/plan/02 §8 */
export const SubscriptionStatusResponseSchema = z.object({
  plan: z.object({
    id: z.string(),
    tier: PlanTierSchema,
    name: z.object({ en: z.string(), ar: z.string() }),
  }),
  status: SubscriptionStatusSchema,
  credits: z.object({
    limit: z.number().int(),
    used: z.number().int(),
    remaining: z.number().int(),
    percentUsed: z.number(),
  }),
  period: z.object({
    startsAt: isoDate,
    expiresAt: isoDate,
    daysLeft: z.number().int().nonnegative(),
  }),
  limits: z.object({
    rpm: z.number().int(),
    allowedModels: z.array(z.string()),
  }),
  lock: z
    .object({ reason: LockReasonSchema, renewUrl: z.string() })
    .nullable(),
  serverTime: isoDate,
});
export type SubscriptionStatusResponse = z.infer<typeof SubscriptionStatusResponseSchema>;

/** Payload of the trailing `: deepcode-usage {json}` SSE comment. */
export const StreamUsageNoticeSchema = z.object({
  requestId: z.string(),
  model: z.string(),
  tokens: z.object({
    input: z.number().int(),
    output: z.number().int(),
    cachedInput: z.number().int(),
    reasoning: z.number().int(),
  }),
  creditsCharged: z.number().int(),
  creditsRemaining: z.number().int(),
  percentUsed: z.number(),
  estimated: z.boolean(),
});
export type StreamUsageNotice = z.infer<typeof StreamUsageNoticeSchema>;

export const GATEWAY_ERROR_CODES = [
  "invalid_api_key",
  "key_revoked",
  "subscription_expired",
  "quota_exhausted",
  "model_not_allowed",
  "rate_limited",
  "upstream_unavailable",
  "bad_request",
  "context_length_exceeded",
  "internal",
] as const;
export const GatewayErrorCodeSchema = z.enum(GATEWAY_ERROR_CODES);
export type GatewayErrorCode = z.infer<typeof GatewayErrorCodeSchema>;

/** HTTP status for each error code. One table, used by the gateway and by clients. */
export const GATEWAY_ERROR_STATUS: Record<GatewayErrorCode, number> = {
  invalid_api_key: 401,
  key_revoked: 401,
  subscription_expired: 402,
  quota_exhausted: 402,
  model_not_allowed: 403,
  rate_limited: 429,
  upstream_unavailable: 503,
  bad_request: 400,
  // The conversation no longer fits: agents compact it and retry (OpenAI's code name).
  context_length_exceeded: 400,
  internal: 500,
};

export const GatewayErrorSchema = z.object({
  error: z.object({
    code: GatewayErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    renewUrl: z.string().optional(),
  }),
});
export type GatewayError = z.infer<typeof GatewayErrorSchema>;

/** Body of POST /internal/invalidate (web -> gateway). */
export const InvalidateRequestSchema = z.object({
  keyHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(1000).optional(),
  userIds: z.array(z.uuid()).max(1000).optional(),
  reloadPool: z.boolean().optional(),
  reloadCatalog: z.boolean().optional(),
});
export type InvalidateRequest = z.infer<typeof InvalidateRequestSchema>;
