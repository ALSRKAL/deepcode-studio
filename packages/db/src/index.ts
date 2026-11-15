import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as core from "./schema/core.js";
import * as usage from "./schema/usage.js";

export * from "./schema/core.js";
export * from "./schema/usage.js";
export * from "./catalog.js";
export { runMigrations, migrationsFolder } from "./migrate.js";

export const schema = { ...core, ...usage };
export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;

export interface DatabaseHandle {
  db: Database;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.max ?? 20,
    idle_timeout: 30,
    connect_timeout: 10,
    // Keep driver notices out of stdout; they are not useful in production logs.
    onnotice: () => {},
  });
  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
