import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { authAccounts, authSessions, authTwoFactor, authVerifications, userRole, userStatus } from "@deepcode/db";
import { db } from "./db";
import { env } from "./env";
import { sendMail } from "./mail";

/**
 * Better Auth's view of the domain `users` table (docs/plan/03 §4): its user model
 * field names plus the additional fields we own. Columns are shared with the rich
 * schema in @deepcode/db; this object exists so the adapter maps names 1:1.
 */
const baUsers = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  role: userRole("role").notNull().default("user"),
  status: userStatus("status").notNull().default("active"),
  locale: text("locale").notNull().default("en"),
  // Managed by the twoFactor plugin's user columns.
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  twoFactorSecret: text("two_factor_secret"),
  backupCodes: text("backup_codes"),
});

/**
 * The single auth instance. Server components and actions call `auth.api.*`;
 * the route handler at /api/auth/[...all] exposes the HTTP surface.
 */
export const auth = betterAuth({
  appName: "DeepCode Studio",
  secret: env.AUTH_SECRET,
  baseURL: env.APP_URL,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db().db, {
    provider: "pg",
    schema: {
      user: baUsers,
      account: authAccounts,
      session: authSessions,
      verification: authVerifications,
      twoFactor: authTwoFactor,
    },
    usePlural: false,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 200,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        locale: userLocale((user as { locale?: string }).locale),
        subjectKey: "resetPassword",
        bodyKey: "resetPassword",
        url,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        locale: userLocale((user as { locale?: string }).locale),
        subjectKey: "verifyEmail",
        bodyKey: "verifyEmail",
        url,
      });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      status: { type: "string", defaultValue: "active", input: false },
      locale: { type: "string", defaultValue: "ar", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    storeSessionInDatabase: true,
  },
  advanced: {
    cookiePrefix: "deepcode",
    database: {
      // Our user/session/account id columns are UUID; better-auth's default ids
      // are 32-char strings that Postgres would reject.
      generateId: "uuid",
    },
    // httpOnly, SameSite=Lax, Secure cookies; CSRF is Next server actions' Origin
    // check plus better-auth's own trustedOrigins validation.
  },
  rateLimit: {
    // In-memory limiter covers auth endpoints per process (docs/plan/03 §4);
    // the security-critical exchange endpoint adds its own Redis limit.
    enabled: true,
    window: 60,
    max: 20,
  },
  socialProviders: {
    // OAuth providers are enabled only when credentials exist; none are needed
    // for local verification (docs/plan/04 Phase 2a).
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET } }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
      : {}),
  },
  plugins: [
    // nextCookies lets server actions set session cookies through next/headers.
    nextCookies(),
    twoFactor({
      issuer: "DeepCode Studio",
      backupCodes: { amount: 5 },
      // Google-only accounts have no password; better-auth still demands it from
      // every account that has one (shouldRequirePassword).
      allowPasswordless: true,
    }),
  ],
});

function userLocale(v: string | null | undefined): "ar" | "en" {
  return v === "ar" ? "ar" : "en";
}

/** Shape returned by auth.api.getSession().user for our additional fields. */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  emailVerified: boolean;
  twoFactorEnabled: boolean;
};
