import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // usage.ts is intentionally excluded: usage_logs is partitioned and created by a
  // hand-written migration (see src/schema/usage.ts).
  schema: "./src/schema/core.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/unused" },
  strict: true,
});
