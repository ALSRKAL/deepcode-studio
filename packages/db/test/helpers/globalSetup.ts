import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { runMigrations } from "@deepcode/db";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let pg: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  pg = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = pg.getConnectionUri();
  await runMigrations(databaseUrl);
  project.provide("databaseUrl", databaseUrl);
}

export async function teardown() {
  await pg?.stop();
}
