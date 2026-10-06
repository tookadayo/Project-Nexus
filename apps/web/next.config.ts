import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@resvg/resvg-js"],
  distDir:
    process.env.NODE_ENV !== "production" &&
    process.env.NEXUS_E2E_ISOLATED === "1"
      ? ".next-e2e"
      : ".next",
};
export default config;
