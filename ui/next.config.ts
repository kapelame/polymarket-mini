import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // disable server components for this app
  },
  // Turn off strict mode to avoid double renders
  reactStrictMode: false,
};

export default nextConfig;
