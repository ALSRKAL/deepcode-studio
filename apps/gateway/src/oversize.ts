/**
 * Oversized requests (customer report 2026-11-18: "Request body too large", status 413).
 *
 * A long agent session keeps every screenshot / pasted image in its history as base64,
 * so the request grows past the body limit and every following turn failed with a 413
 * the agent could not recover from: the session was dead.
 *
 * Now, when a request is over the limit, the gateway first replaces the OLDEST images
 * with a short text note (the newest ones stay, so the model still sees what it is
 * working on). If it still does not fit, the client gets `context_length_exceeded`,
 * which agents (the DeepCode desktop included) answer by compacting the conversation
 * and retrying, instead of a dead end.
 */

export const IMAGE_REMOVED_NOTE = "[An earlier image was removed to keep this conversation within the size limit.]";

/** Images kept (newest first) on the first pass; the last pass keeps only the newest. */
const KEEP_NEWEST_IMAGES = [2, 1, 0] as const;

type Json = Record<string, unknown>;

function isImagePart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const type = (part as Json).type;
  // OpenAI chat: image_url; Responses: input_image; Anthropic: image / document (base64).
  return type === "image_url" || type === "input_image" || type === "image" || type === "document";
}

/** Every content array that may hold image parts, in conversation order. */
function contentArrays(body: Json): unknown[][] {
  const arrays: unknown[][] = [];
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const content = (item as Json).content;
      if (Array.isArray(content)) {
        arrays.push(content);
        // Anthropic tool_result blocks nest their own content arrays.
        for (const block of content) {
          if (block && typeof block === "object" && Array.isArray((block as Json).content)) {
            arrays.push((block as Json).content as unknown[]);
          }
        }
      }
    }
  };
  visit(body.messages); // OpenAI chat, Anthropic messages
  visit(body.input); // OpenAI responses
  return arrays;
}

/** Replace all but the newest `keep` images with a text note. Returns how many were removed. */
export function removeOlderImages(body: Json, keep: number): number {
  const positions: Array<{ list: unknown[]; index: number }> = [];
  for (const list of contentArrays(body)) {
    list.forEach((part, index) => {
      if (isImagePart(part)) positions.push({ list, index });
    });
  }
  const drop = positions.slice(0, Math.max(0, positions.length - keep));
  for (const { list, index } of drop) {
    const original = list[index] as Json;
    // Keep the part type family the protocol expects for text.
    const textType = original.type === "input_image" ? "input_text" : "text";
    list[index] = { type: textType, text: IMAGE_REMOVED_NOTE };
  }
  return drop.length;
}

export function jsonBytes(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

export type ShrinkResult = { ok: true; bytes: number; removedImages: number } | { ok: false; bytes: number };

/** Bring a parsed body under `limit` bytes by removing older images, newest kept longest. */
export function shrinkToFit(body: Json, limit: number): ShrinkResult {
  let bytes = jsonBytes(body);
  let removed = 0;
  for (const keep of KEEP_NEWEST_IMAGES) {
    if (bytes <= limit) break;
    const n = removeOlderImages(body, keep);
    if (n === 0) continue;
    removed += n;
    bytes = jsonBytes(body);
  }
  return bytes <= limit ? { ok: true, bytes, removedImages: removed } : { ok: false, bytes };
}

export function contextTooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  // Worded so agents recognise both "context … exceeded" (compact the conversation)
  // and "image … too large" (strip media when compacting).
  return `Context limit exceeded: the request is ${mb} MB. Images or tool output in the conversation are too large; compact the conversation and retry.`;
}
