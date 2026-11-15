/** Container entry point: `node dist/migrate.js` applies pending migrations and exits. */
import { runMigrations } from "@deepcode/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await runMigrations(url);
console.log("migrations applied");
