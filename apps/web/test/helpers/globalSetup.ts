import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";
import { runMigrations } from "@deepcode/db";
import { randomBytes } from "node:crypto";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
    /** Mailpit UI/API origin — verification emails land here. */
    mailApiUrl: string;
  }
}

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let mail: StartedTestContainer | undefined;

/**
 * Route handlers are plain functions, so the API-surface tests call them directly
 * with a fresh Request. The modules read process.env lazily at first use, so the
 * containers must be wired before the tests import anything.
 */
export async function setup(project: TestProject) {
  [pg, redis, mail] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine").start(),
    new RedisContainer("redis:7-alpine").start(),
    new GenericContainer("axllent/mailpit:latest").withExposedPorts(1025, 8025).start(),
  ]);
  const pgHandle = pg;
  const redisHandle = redis;
  const mailHandle = mail;
  if (!pgHandle || !redisHandle || !mailHandle) throw new Error("test containers failed to start");
  const databaseUrl = pgHandle.getConnectionUri();
  const redisUrl = redisHandle.getConnectionUrl();
  const mailApiUrl = `http://${mailHandle.getHost()}:${mailHandle.getMappedPort(8025)}`;
  await runMigrations(databaseUrl);

  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  // better-auth signs verification tokens; the mail pipeline delivers them.
  process.env.SMTP_URL = `smtp://${mailHandle.getHost()}:${mailHandle.getMappedPort(1025)}`;
  process.env.KEY_HASH_PEPPER = randomBytes(32).toString("base64");
  process.env.POOL_KEY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.AUTH_SECRET = randomBytes(48).toString("base64");
  process.env.GATEWAY_INTERNAL_TOKEN = randomBytes(32).toString("hex");
  process.env.MOCK_BILLING_WEBHOOK_SECRET = randomBytes(32).toString("base64");
  process.env.APP_URL = "http://localhost:3210";
  process.env.BILLING_PROVIDER = "mock";
  process.env.ADMIN_2FA_REQUIRED = "false";
  // Production runs behind a proxy that appends the client address (review
  // 2026-11-15); tests exercise that path so per-IP limits are really per IP.
  process.env.TRUST_PROXY = "true";
  process.env.TRUSTED_PROXY_HOPS = "1";
  process.env.STORAGE_DIR = ".storage-test";
  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redisUrl);
  project.provide("mailApiUrl", mailApiUrl);
}

export async function teardown() {
  await Promise.all([pg?.stop(), redis?.stop(), mail?.stop()]);
}
