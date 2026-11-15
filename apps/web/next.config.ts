import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Locale routing and security headers are handled in middleware.ts.
  reactStrictMode: true,
  poweredByHeader: false,
  // Single-container deploys (infra/render) use the standalone server: far less
  // memory than `next start` with the full node_modules. Opt-in so local
  // `next start` (tests, Playwright) is unchanged.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
    ? { output: "standalone" as const, outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)) }
    : {}),
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
