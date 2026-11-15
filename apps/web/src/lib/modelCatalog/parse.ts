import type { UpstreamApiType } from "@deepcode/shared";

/**
 * Upstream model catalogs → one normalised shape (owner request 2026-11-15).
 * Pure functions: no I/O, so they are tested against real saved responses.
 *
 * Formats:
 *  - `opencode`: OpenCode Go / Zen `/v1/models` — per model `api` (format → base_url),
 *    `cost.text` (USD/MTok), `limit`, `capabilities`, `modalities`.
 *  - `openai`: OpenAI-style `/models` as served by OpenRouter and most compatible
 *    gateways — `context_length`, `pricing` (USD per token, strings),
 *    `architecture.input_modalities`, `supported_parameters`.
 */
export type CatalogFormat = "opencode" | "openai";

export interface NormalizedModel {
  id: string;
  displayName: string;
  description: string | null;
  family: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  capabilities: { tools?: boolean; reasoning?: boolean; vision?: boolean; structuredOutput?: boolean };
  cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number; variable?: boolean } | null;
  isFree: boolean;
  trainsOnData: boolean;
  /** API formats this model is served on, with the upstream base URL when the catalog says. */
  apis: Array<{ apiType: UpstreamApiType; baseUrl: string | null }>;
}

export interface ParseResult {
  models: NormalizedModel[];
  skipped: Array<{ id: string; reason: string }>;
}

const OPENCODE_API: Record<string, UpstreamApiType> = {
  "chat-completions": "openai-chat-completions",
  responses: "openai-responses",
  messages: "anthropic-messages",
  "generate-content": "google-generative-ai",
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Model ids we accept as public ids (also used in URLs and plan lists). */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** Prompts may be kept or trained on: contributor models train by definition. */
function inferTrainsOnData(id: string): boolean {
  return /contributor/i.test(id);
}

function listOf(payload: unknown): unknown[] {
  const root = obj(payload);
  if (root && Array.isArray(root.data)) return root.data;
  return Array.isArray(payload) ? payload : [];
}

export function parseOpencodeCatalog(payload: unknown): ParseResult {
  const models: NormalizedModel[] = [];
  const skipped: ParseResult["skipped"] = [];
  const seen = new Set<string>();
  for (const raw of listOf(payload)) {
    const m = obj(raw);
    const id = str(m?.id);
    if (!m || !id) continue;
    if (!MODEL_ID.test(id)) {
      skipped.push({ id, reason: "invalid id" });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const type = str(m.type) ?? "chat";
    if (type !== "chat") {
      skipped.push({ id, reason: `type ${type} is not a chat model` });
      continue;
    }
    const apiObj = obj(m.api) ?? {};
    const apis: NormalizedModel["apis"] = [];
    for (const [key, value] of Object.entries(apiObj)) {
      const apiType = OPENCODE_API[key];
      if (apiType) apis.push({ apiType, baseUrl: str(obj(value)?.base_url) });
    }
    if (apis.length === 0) {
      skipped.push({ id, reason: "no supported API format" });
      continue;
    }
    const text = obj(obj(m.cost)?.text);
    const input = obj(text?.input);
    const output = obj(text?.output);
    const cache = obj(input?.cache);
    const inPrice = num(input?.price);
    const outPrice = num(output?.price);
    const cost =
      inPrice !== null && outPrice !== null
        ? {
            input: inPrice,
            output: outPrice,
            ...(num(cache?.read) !== null ? { cacheRead: num(cache?.read)! } : {}),
            ...(num(cache?.write) !== null ? { cacheWrite: num(cache?.write)! } : {}),
            ...(Array.isArray(input?.overrides) || Array.isArray(output?.overrides) || Array.isArray(obj(m.cost)?.multipliers)
              ? { variable: true }
              : {}),
          }
        : null;
    const caps = obj(m.capabilities) ?? {};
    const modalities = strList(obj(m.modalities)?.input);
    const limit = obj(m.limit);
    models.push({
      id,
      displayName: str(m.name) ?? id,
      description: str(m.description),
      family: str(m.family),
      contextWindow: num(limit?.context),
      maxOutputTokens: num(limit?.output),
      inputModalities: modalities,
      capabilities: {
        tools: obj(caps.tools)?.supported === true || undefined,
        reasoning: obj(caps.reasoning)?.supported === true || undefined,
        vision: modalities.some((x) => x.startsWith("image")) || undefined,
        structuredOutput: caps.structured_output === true || undefined,
      },
      cost,
      isFree: cost !== null && cost.input === 0 && cost.output === 0,
      trainsOnData: inferTrainsOnData(id),
      apis,
    });
  }
  return { models, skipped };
}

/** OpenAI/OpenRouter format: one API type, the provider's own. Prices are USD per token. */
export function parseOpenAiCatalog(payload: unknown, apiType: UpstreamApiType): ParseResult {
  const models: NormalizedModel[] = [];
  const skipped: ParseResult["skipped"] = [];
  const seen = new Set<string>();
  for (const raw of listOf(payload)) {
    const m = obj(raw);
    const id = str(m?.id);
    if (!m || !id) continue;
    if (!MODEL_ID.test(id)) {
      skipped.push({ id, reason: "invalid id" });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const arch = obj(m.architecture);
    const outputs = strList(arch?.output_modalities);
    if (outputs.length > 0 && !outputs.includes("text")) {
      skipped.push({ id, reason: "does not output text" });
      continue;
    }
    const pricing = obj(m.pricing);
    const perToken = (v: unknown) => {
      const n = num(v);
      return n === null ? null : Math.round(n * 1_000_000 * 1e6) / 1e6; // → USD per MTok
    };
    const input = perToken(pricing?.prompt);
    const output = perToken(pricing?.completion);
    const cacheRead = perToken(pricing?.input_cache_read);
    const cost = input !== null && output !== null ? { input, output, ...(cacheRead !== null ? { cacheRead } : {}) } : null;
    const params = strList(m.supported_parameters);
    const modalities = strList(arch?.input_modalities);
    models.push({
      id,
      displayName: str(m.name) ?? id,
      description: str(m.description),
      family: null,
      contextWindow: num(m.context_length) ?? num(obj(m.top_provider)?.context_length),
      maxOutputTokens: num(obj(m.top_provider)?.max_completion_tokens),
      inputModalities: modalities,
      capabilities: {
        tools: params.includes("tools") || undefined,
        reasoning: params.includes("reasoning") || params.includes("include_reasoning") || undefined,
        vision: modalities.includes("image") || undefined,
        structuredOutput: params.includes("structured_outputs") || params.includes("response_format") || undefined,
      },
      cost,
      isFree: (cost !== null && cost.input === 0 && cost.output === 0) || id.endsWith(":free"),
      trainsOnData: inferTrainsOnData(id),
      apis: [{ apiType, baseUrl: null }],
    });
  }
  return { models, skipped };
}

export function parseCatalog(format: CatalogFormat, payload: unknown, defaultApiType: UpstreamApiType): ParseResult {
  return format === "opencode" ? parseOpencodeCatalog(payload) : parseOpenAiCatalog(payload, defaultApiType);
}

/** USD per MTok → credits per MTok (1 credit = $0.000001, docs/plan/02). */
export function usdPerMTokToCredits(usd: number): number {
  return Math.round(usd * 1_000_000);
}
