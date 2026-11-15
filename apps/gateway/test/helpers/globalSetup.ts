import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";
import { runMigrations } from "@deepcode/db";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(project: TestProject) {
  [pg, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine").start(),
    new RedisContainer("redis:7-alpine").start(),
  ]);
  const databaseUrl = pg.getConnectionUri();
  await runMigrations(databaseUrl);
  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redis.getConnectionUrl());
}

export async function teardown() {
  await Promise.all([pg?.stop(), redis?.stop()]);
}
