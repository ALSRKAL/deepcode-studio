/**
 * Contracts for the web portal and the desktop-facing endpoints (docs/plan/03 §2
 * /api tree, §4.1 desktop deep-link callback, doc 01 §3 client configs).
 */
import { z } from "zod";
import { PLAN_TIERS } from "./constants.js";
import { PlanTierSchema } from "./contracts.js";

// ---- Desktop deep-link authentication (docs/plan/03 §4.1) ---------------------

/** Query of GET /auth/desktop. `state` and `code_challenge` come from the desktop app. */
export const DesktopAuthStartQuerySchema = z.object({
  state: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  code_challenge: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  device_name: z.string().min(1).max(100),
  os: z.string().min(1).max(50),
  app_version: z.string().max(50).optional(),
});
export type DesktopAuthStartQuery = z.infer<typeof DesktopAuthStartQuerySchema>;

/** Body of POST /api/desktop/exchange. The code is 32 bytes, base64url. */
export const DesktopExchangeRequestSchema = z.object({
  code: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  code_verifier: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  device: z.object({
    name: z.string().min(1).max(100),
    os: z.string().min(1).max(50),
    app_version: z.string().max(50).optional(),
  }),
});
export type DesktopExchangeRequest = z.infer<typeof DesktopExchangeRequestSchema>;

/** Response — the device key is shown exactly once. */
export const DesktopExchangeResponseSchema = z.object({
  apiKey: z.string().startsWith("sk-dc-"),
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string().nullable(), locale: z.string() }),
  plan: z.object({ id: z.string(), tier: PlanTierSchema, name: z.object({ en: z.string(), ar: z.string() }) }),
  gatewayBaseUrl: z.url(),
});
export type DesktopExchangeResponse = z.infer<typeof DesktopExchangeResponseSchema>;

/** Error codes of the exchange endpoint (distinct from the gateway's). */
export const DESKTOP_EXCHANGE_ERROR_CODES = [
  "invalid_request",
  "invalid_code",
  "expired_code",
  "used_code",
  "pkce_mismatch",
  "state_mismatch",
  "device_limit",
  "rate_limited",
  "unauthorized",
] as const;
export type DesktopExchangeErrorCode = (typeof DESKTOP_EXCHANGE_ERROR_CODES)[number];

// ---- GET /api/v1/client/configs (consumed by the desktop app) -----------------

export const ClientNoticesSchema = z.object({
  id: z.string(),
  level: z.enum(["info", "warning", "critical"]),
  text: z.object({ en: z.string(), ar: z.string() }),
});

export const ClientConfigsResponseSchema = z.object({
  gatewayUrl: z.url(),
  webUrl: z.url(),
  syncUrl: z.url(),
  releasesUrl: z.url(),
  features: z.object({
    /** Bring-your-own-key section (owner decision 3: behind Advanced). */
    byok: z.boolean(),
    managedSync: z.boolean(),
  }),
  /** Oldest app version the portal still supports. */
  minAppVersion: z.string().optional(),
  notices: z.array(ClientNoticesSchema).max(10),
});
export type ClientConfigsResponse = z.infer<typeof ClientConfigsResponseSchema>;

// ---- Releases manifest (electron-updater UpdateInfo, served as YAML) ----------

/** electron-updater `UpdateInfo`. `sha2` is hex SHA-256 (checked as hex by builder-util-runtime); `sha512` base64. */
export const ElectronManifestFileSchema = z.object({
  url: z.string(),
  sha2: z.string().optional(),
  sha512: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

export const ElectronManifestSchema = z.object({
  version: z.string(),
  releaseDate: z.string(),
  files: z.array(ElectronManifestFileSchema).min(1),
  /** Keyed by Node arch (x64, arm64) when platform-specific metadata is needed. */
  packages: z
    .record(z.string(), z.object({ path: z.string(), sha512: z.string(), size: z.number().int().nonnegative() }))
    .optional(),
  /** Our extension: minimum still-supported app version (semver). */
  minimumVersion: z.string().optional(),
});
export type ElectronManifest = z.infer<typeof ElectronManifestSchema>;

// ---- Skills / MCP sync manifest (docs/plan/01 §8.2, doc 00 §5) ----------------
// The manifest is tier-filtered per requester, so integrity is per item: every
// skill archive and every MCP preset is signed at publish time (Ed25519, public
// key compiled into the desktop app), and each archive carries its sha256.

export const SyncSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  sha256: z.string(),
  /** Absolute download URL for the archive. */
  url: z.url(),
  minTier: z.enum(PLAN_TIERS),
  /** base64 Ed25519 signature over canonicalJson({id, version, sha256}). */
  signature: z.string(),
});
export const SyncMcpPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  minTier: z.enum(PLAN_TIERS),
  /** Inert template; enabling is always a local user action. */
  config: z.object({
    transport: z.enum(["stdio", "sse", "http"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
  }),
  /** base64 Ed25519 signature over canonicalJson(config). */
  signature: z.string(),
});
export const SyncManifestSchema = z.object({
  revision: z.number().int(),
  skills: z.array(SyncSkillSchema).max(500),
  mcpPresets: z.array(SyncMcpPresetSchema).max(200),
});
export type SyncManifest = z.infer<typeof SyncManifestSchema>;
