import type { TokenUsage, UpstreamApiType } from "@deepcode/shared";
import type { SseEvent } from "./sse.js";

export interface RequestContext {
  /** Parsed JSON request body. */
  body: Record<string, any>;
  /** Model taken from the URL (Google style), if any. */
  pathModel?: string;
  /** Method taken from the URL (Google style): generateContent | streamGenerateContent. */
  pathMethod?: string;
  /** Query parameters of the incoming request. */
  query: URLSearchParams;
  /** Incoming request headers. Only an explicit allowlist is ever forwarded upstream. */
  headers: Headers;
}

export interface PreparedBody {
  body: Record<string, any>;
  /** True when the gateway added a usage request the client did not ask for. */
  injectedUsage: boolean;
}

export interface StreamState {
  /** Inspect one event. `forward: false` withholds it; `terminal: true` holds it until settlement. */
  onEvent(ev: SseEvent): { forward: boolean; terminal: boolean };
  usage(): TokenUsage | null;
  /** Content-bearing events seen; used only for the output estimate when usage is missing. */
  contentEvents(): number;
}

export interface ProtocolAdapter {
  apiType: UpstreamApiType;
  extractModel(ctx: RequestContext): string | undefined;
  isStream(ctx: RequestContext): boolean;
  /** Path appended to the provider's base URL for this API type. */
  upstreamPath(upstreamModel: string, ctx: RequestContext, stream: boolean): string;
  authHeaders(secret: string): Record<string, string>;
  /** Requested output-token limit, if the client set one. */
  requestedMaxOutput(ctx: RequestContext): number | undefined;
  prepareBody(ctx: RequestContext, opts: { upstreamModel: string; stream: boolean; maxOutputTokens: number | null }): PreparedBody;
  createStreamState(opts: { injectedUsage: boolean }): StreamState;
  usageFromJson(json: any): TokenUsage | null;
  /** Protocol-shaped event that tells a client the stream failed mid-way. */
  terminalErrorEvent(): string;
}

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function clampField(obj: Record<string, any>, field: string, cap: number | null): void {
  if (cap === null) return;
  const v = obj[field];
  if (typeof v === "number" && v > cap) obj[field] = cap;
}
