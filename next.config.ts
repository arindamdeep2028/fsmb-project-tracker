import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Signed URLs point at Supabase Storage; images are shown with <img>, so no remote patterns are needed.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  poweredByHeader: false,
  // The Content-Security-Policy carries a per-request nonce, so middleware.ts sets it; these apply to every path.
  async headers() {
    return [{ source: "/:path*", headers: STATIC_SECURITY_HEADERS }];
  },
};

export default nextConfig;
