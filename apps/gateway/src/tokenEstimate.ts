/**
 * Input-size estimate for the hard context cap (docs/plan/06 §4).
 *
 * The gateway never had a tokenizer: the old `bytes / 4` estimate treats an
 * image's base64 payload as text and overstates a 1 MB screenshot by ~250K
 * tokens. This walks the request instead:
 *
 * - every text string contributes `length / 3` (the same divisor the desktop
 *   uses in `ESTIMATED_TOKEN_CHAR_DIVISOR`, so the numbers in the error message
 *   match the client's own bookkeeping);
 * - every image/document contributes a flat estimate and its base64 data is not
 *   counted;
 * - tool schemas, system prompts and tool results are counted because they are
 *   part of the upstream prompt.
 *
 * This is a safety cap, not billing: settlement still uses the provider's
 * reported usage.
 */
const IMAGE_TOKENS = 1_600;
/** Kept in step with the desktop's `ESTIMATED_TOKEN_CHAR_DIVISOR` (packages/shared). */
const CHARS_PER_TOKEN = 3;
const IMAGE_PART_TYPES = new Set([
  "image_url",
  "input_image",
  "image",
  "document",
  "input_file",
  "file",
]);
const IMAGE_PAYLOAD_KEYS = new Set(["inlineData", "inline_data", "fileData", "file_data"]);

export function estimateInputTokens(body: unknown): number {
  const { chars, images } = walk(body);
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
}

function walk(value: unknown, depth = 0): { chars: number; images: number } {
  // A hostile or broken body can nest deeper than the JSON parser allows us to
  // care about; treat anything past this as opaque instead of recursing forever.
  if (depth > 100) return { chars: 0, images: 0 };

  if (typeof value === "string") {
    if (value.startsWith("data:image/") || value.startsWith("data:application/pdf")) {
      return { chars: 0, images: 1 };
    }
    return { chars: value.length, images: 0 };
  }
  if (Array.isArray(value)) {
    let chars = 0;
    let images = 0;
    for (const item of value) {
      const part = walk(item, depth + 1);
      chars += part.chars;
      images += part.images;
    }
    return { chars, images };
  }
  if (!value || typeof value !== "object") return { chars: 0, images: 0 };

  const record = value as Record<string, unknown>;
  const type = record.type;
  // An image part can carry a caption text too, but the flat image estimate is
  // already generous; counting the base64 as text is what we must avoid.
  if (typeof type === "string" && IMAGE_PART_TYPES.has(type)) {
    return { chars: 0, images: 1 };
  }

  let chars = 0;
  let images = 0;
  for (const [key, child] of Object.entries(record)) {
    if (IMAGE_PAYLOAD_KEYS.has(key)) {
      images += 1;
      continue;
    }
    chars += key.length;
    const part = walk(child, depth + 1);
    chars += part.chars;
    images += part.images;
  }
  return { chars, images };
}
