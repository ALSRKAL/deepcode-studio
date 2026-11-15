import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const alias = [{ find: /^@\/(.*)/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) }];

export default defineConfig({
  resolve: {
    conditions: ["@deepcode/source"],
    alias,
  },
  ssr: {
    resolve: {
      conditions: ["@deepcode/source"],
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/helpers/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
