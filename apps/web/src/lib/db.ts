import { createDatabase } from "@deepcode/db";
import { env } from "./env";

let handle: ReturnType<typeof createDatabase> | null = null;

/**
 * One pooled handle per server process. `env` throws only at runtime when invalid
 * (it skips validation during `next build` page-data collection).
 */
export function db() {
  if (!handle) handle = createDatabase(env.DATABASE_URL, { max: 10 });
  return handle;
}
