import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./index.js";

/**
 * Resolved at call time, not statically: webpack turns `new URL(..., import.meta.url)`
 * into a build-time asset lookup, which breaks Next.js builds that bundle this package.
 */
export function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../migrations");
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const handle = createDatabase(databaseUrl, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: migrationsFolder() });
  } finally {
    await handle.close();
  }
}
