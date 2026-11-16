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

/**
 * OpenCode Go allowance pricing (https://opencode.ai/docs/go, read 2026-11-16).
 *
 * A Go subscription is ONE monthly allowance; each model's "monthly limit" says how
 * many dollars of its token price fill that allowance (5-hour window 20%, weekly 50%).
 * $1 of a $15-limit model therefore uses 4x the allowance of $1 of a $60-limit model.
 * Our credit price = Go token price x (60 / model limit), so one Go key carries about
 * GO_KEY_CREDITS credits per month whatever the model mix, and plans can be sized
 * against keys. Peak prices are used where Go has peak/off-peak, the lower context
 * tier where it has tiers. Models that train on prompts are left out on purpose.
 */
export type GoTier = "free" | "economy" | "mid" | "premium";
export interface GoModelPrice {
  /** USD per 1M tokens: input, output, cached read. */
  usd: [number, number, number];
  /** Go monthly limit in USD (Go plan); null = free model. */
  monthlyLimitUsd: number | null;
  tier: GoTier;
}
export const GO_KEY_CREDITS = 60_000_000;
export const GO_MODEL_PRICES: Record<string, GoModelPrice> = {
  "beam-free": { usd: [0, 0, 0], monthlyLimitUsd: null, tier: "free" },
  "longcat-2.5-free": { usd: [0, 0, 0], monthlyLimitUsd: null, tier: "free" },
  "deepseek-v4.1-flash": { usd: [0.3, 1.2, 0.006], monthlyLimitUsd: 100, tier: "economy" },
  "glm-5.3-flash": { usd: [0.15, 0.5, 0.03], monthlyLimitUsd: 60, tier: "economy" },
  "glm-5.2": { usd: [1.4, 4.4, 0.26], monthlyLimitUsd: 60, tier: "economy" },
  "kimi-k2.7-code": { usd: [0.95, 4, 0.19], monthlyLimitUsd: 60, tier: "economy" },
  "longcat-2.0": { usd: [0.3, 1.2, 0.006], monthlyLimitUsd: 60, tier: "economy" },
  "mimo-v2.6-flash": { usd: [0.14, 0.28, 0.0028], monthlyLimitUsd: 60, tier: "economy" },
  "mimo-v2.5": { usd: [0.14, 0.28, 0.0028], monthlyLimitUsd: 60, tier: "economy" },
  "minimax-m3": { usd: [0.3, 1.2, 0.06], monthlyLimitUsd: 60, tier: "economy" },
  "qwen3.7-plus": { usd: [0.4, 1.6, 0.04], monthlyLimitUsd: 60, tier: "economy" },
  hy4: { usd: [0.834, 2.501, 0.042], monthlyLimitUsd: 60, tier: "economy" },
  hy3: { usd: [0.14, 0.58, 0.035], monthlyLimitUsd: 60, tier: "economy" },
  "qwen3.8-flash": { usd: [0.15, 0.47, 0.016], monthlyLimitUsd: 30, tier: "mid" },
  "hy4-preview": { usd: [0.834, 2.501, 0.042], monthlyLimitUsd: 30, tier: "mid" },
  "gemini-4-argon": { usd: [2, 10, 0.1], monthlyLimitUsd: 30, tier: "mid" },
  "minimax-m3.1-flash": { usd: [0.15, 0.6, 0.015], monthlyLimitUsd: 20, tier: "mid" },
  "glm-5.3": { usd: [1.4, 4.4, 0.26], monthlyLimitUsd: 15, tier: "premium" },
  "kimi-k3.1-pro": { usd: [2, 10, 0.2], monthlyLimitUsd: 15, tier: "premium" },
  "kimi-k3": { usd: [3, 15, 0.3], monthlyLimitUsd: 15, tier: "premium" },
  "step-5-preview": { usd: [1, 2.7, 0.1], monthlyLimitUsd: 15, tier: "premium" },
  "mimo-v2.6-pro": { usd: [0.435, 0.87, 0.003625], monthlyLimitUsd: 15, tier: "premium" },
  "mimo-v2.5-pro": { usd: [0.435, 0.87, 0.003625], monthlyLimitUsd: 15, tier: "premium" },
  "qwen4-max": { usd: [1.5, 4.5, 0.075], monthlyLimitUsd: 15, tier: "premium" },
  "qwen3.8-max": { usd: [2, 6, 0.25], monthlyLimitUsd: 15, tier: "premium" },
  "deepseek-v4-pro": { usd: [1.32, 3.96, 0.044], monthlyLimitUsd: 15, tier: "premium" },
  "grok-4.7": { usd: [2, 6, 0.5], monthlyLimitUsd: 15, tier: "premium" },
  "gpt-6-luna": { usd: [0.1, 0.5, 0.01], monthlyLimitUsd: 15, tier: "premium" },
  "gpt-5.6-luna": { usd: [0.2, 1.2, 0.02], monthlyLimitUsd: 15, tier: "premium" },
  "claude-haiku-5-5": { usd: [0.1, 0.5, 0.01], monthlyLimitUsd: 15, tier: "premium" },
};

/** Credits per 1M tokens [input, output, cached] for a Go model, weighted by its allowance share. */
export function goWeightedCredits(price: GoModelPrice): [number, number, number] {
  const weight = price.monthlyLimitUsd ? 60 / price.monthlyLimitUsd : 0;
  return price.usd.map((usd) => usdPerMTokToCredits(usd * weight)) as [number, number, number];
}

const goModelsOfTiers = (tiers: GoTier[]) =>
  Object.entries(GO_MODEL_PRICES)
    .filter(([, p]) => tiers.includes(p.tier))
    .map(([id]) => id);

/** Hosted plan layout (owner decision 2026-11-16): credits sized against GO_KEY_CREDITS. */
export const GO_PLAN_LAYOUT: Record<string, { creditsPerPeriod: number; allowedModels: string[] }> = {
  "starter-monthly": { creditsPerPeriod: 6_000_000, allowedModels: goModelsOfTiers(["free", "economy"]) },
  "pro-monthly": { creditsPerPeriod: 20_000_000, allowedModels: goModelsOfTiers(["free", "economy", "mid", "premium"]) },
  "team-monthly": { creditsPerPeriod: 60_000_000, allowedModels: goModelsOfTiers(["free", "economy", "mid", "premium"]) },
};

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
