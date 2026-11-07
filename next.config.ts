import type { NextConfig } from "next";

/**
 * Notes
 * - Cache Components is intentionally OFF. Every page that reads team data is
 *   rendered per request, so a publish is visible on the very next page load
 *   (no stale ISR/data-cache entries to invalidate).
 * - Security headers that do not need a per-request nonce live here; the
 *   nonce-based Content-Security-Policy is set in `src/proxy.ts`.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `output: "standalone"` is used for the Docker image; Vercel does not need it.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  serverExternalPackages: ["pg", "nodemailer"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Private/authenticated API responses must never be stored by shared caches.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
