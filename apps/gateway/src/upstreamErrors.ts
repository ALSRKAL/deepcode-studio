/**
 * Upstream error shapes that arrive with a success status (customer report 2026-11-18).
 *
 * Synthetic sometimes answers a request with HTTP 200 and the body
 * `{"error":"Error from inference backend: Internal server error"}` — either as the
 * whole JSON response or as the first/only SSE `data:` event. The error is a plain
 * string, not the OpenAI `{ error: { message } }` object, so OpenAI-compatible clients
 * (the desktop agent's AI SDK) fail schema validation ("Type validation failed …
 * expected array, received undefined") instead of seeing a retryable error.
 *
 * The gateway now:
 *  - detects such a body before forwarding anything, and retries like a 5xx;
 *  - rewrites one that appears mid-stream into the OpenAI error shape.
 */
import { SseFramer } from "./protocols/sse.js";

/** True for a JSON payload that is an error report and carries no model output. */
export function isUpstreamErrorPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (!("error" in obj) || obj.error === null || obj.error === undefined) return false;
  // Real output alongside an error field is still output.
  return !("choices" in obj) && !("candidates" in obj) && !("output" in obj) && !("content" in obj);
}

export function upstreamErrorMessage(value: unknown): string {
  const err = (value as { error?: unknown })?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "Upstream error.";
}

/** Parse a JSON body; undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** An SSE data event normalised to `{ error: { message, type, code } }` (OpenAI shape). */
export function openAiErrorEvent(message: string): string {
  return `data: ${JSON.stringify({
    error: { message: message.slice(0, 500), type: "upstream_error", code: "upstream_unavailable" },
  })}\n\n`;
}

/**
 * If an SSE event carries a string `error` (not the OpenAI object), return the event
 * rewritten into the OpenAI error shape; otherwise null.
 */
export function normalizeStreamErrorEvent(data: string): string | null {
  if (!data.includes('"error"')) return null;
  const parsed = parseJson(data);
  if (!isUpstreamErrorPayload(parsed)) return null;
  const err = (parsed as { error: unknown }).error;
  if (err && typeof err === "object") return null; // already an object: clients understand it
  return openAiErrorEvent(upstreamErrorMessage(parsed));
}

export type StreamProbe =
  | { kind: "error"; message: string }
  | { kind: "ok"; buffered: Buffer[]; rest: AsyncIterator<Buffer>; ended: boolean };

/**
 * Read a stream until its first SSE event that has data. An error-only first event
 * means the request failed before producing anything, so it can still be retried.
 * Everything read is kept so the caller can replay it unchanged.
 */
export async function probeEventStream(body: AsyncIterable<Buffer>, maxBytes = 64 * 1024): Promise<StreamProbe> {
  const iterator = body[Symbol.asyncIterator]();
  const framer = new SseFramer();
  const buffered: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) {
      const tail = framer.flush();
      if (tail && tail.data) {
        const parsed = parseJson(tail.data);
        if (isUpstreamErrorPayload(parsed)) return { kind: "error", message: upstreamErrorMessage(parsed) };
      }
      // A body made of a single bare JSON error (no SSE framing) is an error too.
      const whole = Buffer.concat(buffered).toString("utf8").trim();
      const bare = whole.startsWith("{") ? parseJson(whole) : undefined;
      if (isUpstreamErrorPayload(bare)) return { kind: "error", message: upstreamErrorMessage(bare) };
      return { kind: "ok", buffered, rest: iterator, ended: true };
    }
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    buffered.push(chunk);
    size += chunk.length;
    for (const ev of framer.push(chunk)) {
      if (!ev.data) continue; // comments / keep-alives
      if (ev.data === "[DONE]") return { kind: "ok", buffered, rest: iterator, ended: false };
      const parsed = parseJson(ev.data);
      if (isUpstreamErrorPayload(parsed)) {
        await iterator.return?.().catch(() => {});
        return { kind: "error", message: upstreamErrorMessage(parsed) };
      }
      return { kind: "ok", buffered, rest: iterator, ended: false };
    }
    if (size > maxBytes) return { kind: "ok", buffered, rest: iterator, ended: false };
  }
}

/** A response body that replays already-read chunks, then continues the original. */
export function replayBody(buffered: Buffer[], rest: AsyncIterator<Buffer>, ended: boolean) {
  const iterable: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < buffered.length) return { value: buffered[i++]!, done: false };
          if (ended) return { value: undefined, done: true };
          return rest.next();
        },
        async return() {
          await rest.return?.().catch(() => {});
          return { value: undefined, done: true };
        },
      };
    },
  };
  return Object.assign(iterable, {
    async text(): Promise<string> {
      const parts: Buffer[] = [];
      for await (const c of iterable) parts.push(c);
      return Buffer.concat(parts).toString("utf8");
    },
    async dump(): Promise<void> {
      await rest.return?.().catch(() => {});
    },
  });
}

/**
 * Synthetic's context overflow: `400 {"error":"Error from inference backend: 400 The input
 * (700021 tokens) is longer than the model's context length (524288 tokens)."}`
 * (measured 2026-11-18). That wording has neither "exceeded" nor "too long", so agents
 * did not recognise it and the session died instead of compacting.
 */
const CONTEXT_OVERFLOW =
  /longer than the model'?s context length|maximum context length|context (length|window) (is |was )?(exceeded|too)|exceeds? (the )?(model'?s )?(maximum )?context|prompt is too long|too many (input )?tokens/i;

export function isContextOverflowMessage(message: string): boolean {
  return CONTEXT_OVERFLOW.test(message);
}

export type BackendErrorKind = "context" | "client" | "transient";

/** Decide whether a backend error is worth retrying. */
export function classifyBackendError(message: string): BackendErrorKind {
  if (isContextOverflowMessage(message)) return "context";
  // "Error from inference backend: 400 …" — the backend rejected this request itself.
  if (/backend:?\s*4\d\d\b/i.test(message)) return "client";
  return "transient";
}
