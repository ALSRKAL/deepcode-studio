import { z } from "zod";

/**
 * Web environment (docs/plan/00 §6). Only variable NAMES may be logged. Values
 * class S are server-only; nothing non-NEXT_PUBLIC may reach a client component.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  POOL_KEY_ENCRYPTION_KEY: z.string().min(1),
  KEY_HASH_PEPPER: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  GATEWAY_INTERNAL_TOKEN: z.string().min(32),
  APP_URL: z.url().default("http://localhost:3210"),
  /** Canonical public origin for metadata, sitemap and social previews. */
  SITE_URL: z.url().optional(),
  /** Public support address shown on /contact when set. */
  SUPPORT_EMAIL: z.email().optional(),
  GATEWAY_URL: z.url().default("http://127.0.0.1:8790"),
  BILLING_PROVIDER: z.enum(["mock", "stripe", "upi"]).default("mock"),
  /** 24-hour free trial for new accounts (limited-time offer); "false" turns it off. */
  TRIAL_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * UPI QR payments with manual approval (owner decision 2026-11-15). The payee
   * VPA (e.g. name@ybl) and display name go into the QR; amounts come from plans.
   */
  UPI_PAYEE_VPA: z.string().regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/).optional(),
  UPI_PAYEE_NAME: z.string().min(1).max(60).default("DeepCode Studio"),
  /** Hours a created payment stays open before it expires. */
  UPI_PAYMENT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  /**
   * Firebase project of the admin phone app (the smm admin app): used to verify
   * the admin's ID token and to push "new payment" notifications to its topic.
   */
  FIREBASE_ADMIN_PROJECT_ID: z.string().optional(),
  FIREBASE_ADMIN_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_ADMIN_PRIVATE_KEY: z.string().optional(),
  ADMIN_PUSH_TOPIC: z.string().regex(/^[a-zA-Z0-9-_.~%]{1,900}$/).default("admins"),
  /**
   * Mock checkout grants paid plans without money changing hands (review H1).
   * It is only allowed when explicitly enabled AND outside a production build —
   * except local staging images (NODE_ENV=production inside Docker), which opt in
   * with ALLOW_MOCK_BILLING=true. Never enable it on a public deployment.
   */
  ALLOW_MOCK_BILLING: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** HMAC secret for the local mock-billing webhook (dev/test only). */
  MOCK_BILLING_WEBHOOK_SECRET: z.string().optional(),
  /** SMTP for verification / password-reset email (local Mailpit in dev). */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("no-reply@deepcode.example"),
  /** base64 PKCS#8 Ed25519 private key signing the Skills/MCP sync manifest. */
  MANIFEST_SIGNING_KEY: z.string().optional(),
  MANIFEST_KEY_ID: z.string().default("deepcode-sync-1"),
  /** Skills archives live here; must not be served statically. */
  STORAGE_DIR: z.string().default(".storage"),
  /** Admin panel demands TOTP 2FA (docs/plan/03 §6); tests may disable. */
  ADMIN_2FA_REQUIRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Number of trusted proxies that append to X-Forwarded-For (counted from the right). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/**
 * Mock checkout is a local/test-only provider (review H1): allow when explicitly
 * opted in, or when this is not a production build. Production without an
 * explicit opt-in refuses the mock checkout instead of granting free plans.
 */
export function mockBillingAllowed(e: Pick<z.infer<typeof EnvSchema>, "ALLOW_MOCK_BILLING" | "BILLING_PROVIDER"> = parsed.success ? parsed.data : ({} as never)): boolean {
  if (e.BILLING_PROVIDER !== "mock") return false;
  if (e.ALLOW_MOCK_BILLING === true) return true;
  return process.env.NODE_ENV !== "production";
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid web environment: ${names}`);
  }
}

export const env = (parsed.success ? parsed.data : {}) as z.infer<typeof EnvSchema>;
export const isBuildTime = !parsed.success;
