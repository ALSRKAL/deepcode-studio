import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@deepcode/source"] },
  ssr: { resolve: { conditions: ["@deepcode/source"] } },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/helpers/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
