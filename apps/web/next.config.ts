import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// The repo keeps a single .env at its root; Next.js only reads apps/web/.env*.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Out of the sidebar's corner.
  devIndicators: { position: "bottom-right" },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
