import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E + visual + a11y (W-09 … W-12) against the production server on the dev
 * database. `pnpm build && pnpm start` must have run; the config reuses a
 * server that is already listening (developer-started) and prints a clear
 * hint otherwise.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "ar-desktop", use: { ...devices["Desktop Chrome"], locale: "ar" } },
    { name: "en-desktop", use: { ...devices["Desktop Chrome"], locale: "en" } },
    { name: "ar-mobile", use: { ...devices["Pixel 7"], locale: "ar" } },
    { name: "en-mobile", use: { ...devices["iPhone 13"], locale: "en" } },
  ],
});
