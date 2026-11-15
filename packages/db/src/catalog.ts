/**
 * Development catalog: upstream provider, model routes, prices and placeholder plans.
 *
 * Sources: https://opencode.ai/docs/go, read 2026-11-14.
 * - Base URLs and the model -> native API mapping come from the docs' endpoint table.
 *   The docs say every text model also works through the other APIs; we route each
 *   model to its native API.
 * - Prices marked `verified: true` are the docs' Go per-token prices. Others are a
 *   conservative PLACEHOLDER and must be replaced before launch.
 * - Tiered prices (Claude Haiku 5.5 and GPT 6 Luna have higher prices above 100K /
 *   272K context) are NOT modelled yet; the lower tier is used.
 * - The Gemini 4 Argon price is a promotional 50% discount "through November 30, 2026".
 *
 * PLANS ARE PLACEHOLDERS for development only (docs/plan/04 §6, decision 5).
 */
import type { UpstreamApiType } from "@deepcode/shared";

export const OPENCODE_GO_PROVIDER = {
  id: "opencode-go",
  displayName: "OpenCode Go",
  baseUrls: {
    "openai-chat-completions": "https://opencode.ai/inference/go/openai/v1",
    "openai-responses": "https://opencode.ai/inference/go/openai/v1",
    "anthropic-messages": "https://opencode.ai/inference/go/anthropic/v1",
    "google-generative-ai": "https://opencode.ai/inference/go/google/v1beta",
  } satisfies Record<UpstreamApiType, string>,
  // The Go usage policy asks clients to send a stable session id in this header.
  sessionHeader: "x-opencode-session",
  // Public model list (no key needed), OpenCode catalog format (admin "Sync models").
  catalogFormat: "opencode",
  modelsUrl: "https://opencode.ai/inference/go/v1/models",
  hideModelPattern: null as string | null,
};

/**
 * Provider presets the admin can enable (seeded disabled). Read 2026-11-15:
 * https://opencode.ai/docs/zen — Zen free chat models "require OpenCode; use paid
 * models or Go from other clients", so they are imported hidden.
 */
export const OPENCODE_ZEN_PROVIDER = {
  id: "opencode-zen",
  displayName: "OpenCode Zen",
  baseUrls: {
    "openai-chat-completions": "https://opencode.ai/inference/openai/v1",
    "openai-responses": "https://opencode.ai/inference/openai/v1",
    "anthropic-messages": "https://opencode.ai/inference/anthropic/v1",
    "google-generative-ai": "https://opencode.ai/inference/google/v1beta",
  } satisfies Record<UpstreamApiType, string>,
  sessionHeader: "x-opencode-session",
  catalogFormat: "opencode",
  modelsUrl: "https://opencode.ai/inference/v1/models",
  hideModelPattern: "(-free$|^big-pickle$)",
};

export const OPENROUTER_PROVIDER = {
  id: "openrouter",
  displayName: "OpenRouter",
  baseUrls: { "openai-chat-completions": "https://openrouter.ai/api/v1" } as Partial<Record<UpstreamApiType, string>>,
  sessionHeader: null as string | null,
  catalogFormat: "openai",
  modelsUrl: "https://openrouter.ai/api/v1/models",
  hideModelPattern: null as string | null,
};

interface CatalogModel {
  id: string;
  apiType: UpstreamApiType;
  /** USD per million tokens: [input, output, cached input]. */
  usd: [number, number, number];
  verified: boolean;
  /** Provider trains on prompts (per the docs' privacy table). Excluded from default plans. */
  trainsOnPrompts?: boolean;
  free?: boolean;
}

const PLACEHOLDER: [number, number, number] = [3, 15, 0.3];

export const CATALOG_MODELS: CatalogModel[] = [
  // OpenAI Responses
  { id: "grok-4.7", apiType: "openai-responses", usd: PLACEHOLDER, verified: false },
  { id: "gpt-6-luna", apiType: "openai-responses", usd: [0.1, 0.5, 0.01], verified: true },
  { id: "gpt-5.6-luna", apiType: "openai-responses", usd: PLACEHOLDER, verified: false },
  { id: "muse-spark-1.3-contributor", apiType: "openai-responses", usd: PLACEHOLDER, verified: false, trainsOnPrompts: true },
  { id: "muse-spark-1.2-contributor", apiType: "openai-responses", usd: PLACEHOLDER, verified: false, trainsOnPrompts: true },
  // Anthropic Messages
  { id: "claude-haiku-5-5", apiType: "anthropic-messages", usd: [0.1, 0.5, 0.01], verified: true },
  { id: "minimax-m3", apiType: "anthropic-messages", usd: PLACEHOLDER, verified: false },
  { id: "qwen3.8-max", apiType: "anthropic-messages", usd: PLACEHOLDER, verified: false },
  { id: "qwen3.8-flash", apiType: "anthropic-messages", usd: PLACEHOLDER, verified: false },
  { id: "qwen3.7-plus", apiType: "anthropic-messages", usd: PLACEHOLDER, verified: false },
  // Google
  { id: "gemini-4-argon", apiType: "google-generative-ai", usd: [2, 10, 0.1], verified: true },
  // OpenAI Chat Completions
  { id: "glm-5.3-flash", apiType: "openai-chat-completions", usd: [0.15, 0.5, 0.03], verified: true },
  { id: "glm-5.3", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "glm-5.2", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "kimi-k3.1-pro", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "kimi-k3", apiType: "openai-chat-completions", usd: [3, 15, 0.3], verified: true },
  { id: "kimi-k2.7-code", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "longcat-2.0", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "deepseek-v4.1-flash", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "deepseek-v4-pro", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "mimo-v2.6-flash", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "mimo-v2.6-pro", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "mimo-v2.5", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "mimo-v2.5-pro", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "minimax-m3.1-flash", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "hy4", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "hy4-preview", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "hy3", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "step-5-preview", apiType: "openai-chat-completions", usd: PLACEHOLDER, verified: false },
  { id: "beam-free", apiType: "openai-chat-completions", usd: [0, 0, 0], verified: true, free: true },
  { id: "iceman-contributor-free", apiType: "openai-chat-completions", usd: [0, 0, 0], verified: true, free: true, trainsOnPrompts: true },
  { id: "longcat-2.5-free", apiType: "openai-chat-completions", usd: [0, 0, 0], verified: true, free: true },
];

export const usdPerMTokToCredits = (usd: number) => Math.round(usd * 1_000_000);

const privateModels = CATALOG_MODELS.filter((m) => !m.trainsOnPrompts);
const freeModels = privateModels.filter((m) => m.free).map((m) => m.id);
const cheapModels = [...freeModels, "glm-5.3-flash", "gpt-6-luna", "claude-haiku-5-5", "deepseek-v4.1-flash"];
const allPrivate = privateModels.map((m) => m.id);

export const PLACEHOLDER_PLANS = [
  {
    id: "free",
    tier: "free" as const,
    nameEn: "Free",
    nameAr: "مجاني",
    priceCents: 0,
    creditsPerPeriod: 200_000,
    rpmLimit: 10,
    maxConcurrentStreams: 1,
    allowedModels: [...freeModels, "glm-5.3-flash"],
    maxOutputTokens: 8_192,
    maxDevices: 1,
    sortOrder: 0,
  },
  {
    id: "starter-monthly",
    tier: "starter" as const,
    nameEn: "Starter",
    nameAr: "المبتدئ",
    priceCents: 1_000,
    creditsPerPeriod: 5_000_000,
    rpmLimit: 30,
    maxConcurrentStreams: 2,
    allowedModels: cheapModels,
    maxOutputTokens: 32_000,
    maxDevices: 2,
    sortOrder: 1,
  },
  {
    id: "pro-monthly",
    tier: "pro" as const,
    nameEn: "Pro",
    nameAr: "احترافي",
    priceCents: 3_000,
    creditsPerPeriod: 20_000_000,
    rpmLimit: 60,
    maxConcurrentStreams: 4,
    allowedModels: allPrivate,
    maxOutputTokens: 64_000,
    maxDevices: 3,
    sortOrder: 2,
  },
  {
    id: "team-monthly",
    tier: "team" as const,
    nameEn: "Team",
    nameAr: "الفريق",
    priceCents: 8_000,
    creditsPerPeriod: 60_000_000,
    rpmLimit: 120,
    maxConcurrentStreams: 8,
    allowedModels: allPrivate,
    maxOutputTokens: 64_000,
    maxDevices: 10,
    sortOrder: 3,
  },
];
