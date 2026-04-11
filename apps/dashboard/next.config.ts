import type { NextConfig } from "next";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/engine/:path*",
        destination: `${ENGINE_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
