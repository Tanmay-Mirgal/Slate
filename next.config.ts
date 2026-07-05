import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Disable type checking during production builds to avoid Out Of Memory errors
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
