import {
  GATEWAY_ERROR_STATUS,
  USAGE_HEADERS,
  type GatewayError,
  type GatewayErrorCode,
} from "@deepcode/shared";

const DEFAULT_MESSAGES: Record<GatewayErrorCode, string> = {
  invalid_api_key: "Invalid API key.",
  key_revoked: "This API key has been revoked.",
  subscription_expired: "Your subscription has expired. Renew it to continue.",
  quota_exhausted: "You have used all credits for this period.",
  model_not_allowed: "This model is not available on your plan.",
  rate_limited: "Too many requests. Slow down and retry shortly.",
  upstream_unavailable: "The model provider is temporarily unavailable. Retry shortly.",
  bad_request: "The request is invalid.",
  internal: "Internal error.",
};

/**
 * The only error type that becomes a client response. Messages are ours; upstream
 * text never reaches a client through this class except via `sanitizeUpstreamMessage`.
 */
export class GatewayHttpError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message?: string,
    readonly extra: { retryAfterSec?: number; renewUrl?: string; httpStatus?: number } = {},
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "GatewayHttpError";
  }

  get status(): number {
    return this.extra.httpStatus ?? GATEWAY_ERROR_STATUS[this.code];
  }
}

export function errorBody(err: GatewayHttpError, requestId: string): GatewayError {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.extra.renewUrl ? { renewUrl: err.extra.renewUrl } : {}),
    },
  };
}

export function errorResponse(
  err: GatewayHttpError,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  const h = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
    [USAGE_HEADERS.requestId]: requestId,
    ...headers,
  });
  if (err.extra.retryAfterSec !== undefined) {
    h.set("retry-after", String(Math.max(1, Math.ceil(err.extra.retryAfterSec))));
  }
  return new Response(JSON.stringify(errorBody(err, requestId)), { status: err.status, headers: h });
}
