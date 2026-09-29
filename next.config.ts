import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Signed URLs point at Supabase Storage; images are shown with <img>, so no remote patterns are needed.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
