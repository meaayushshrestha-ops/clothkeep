/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  async headers() {
    // In development, don't set security headers (or you can keep them but allow unsafe-eval).
    if (!isProd) {
      // Option A (simplest): no headers in dev
      return [];
      // Option B (keep headers in dev but allow eval):
      // const cspDev = [
      //   "default-src 'self'",
      //   "base-uri 'self'",
      //   "frame-ancestors 'none'",
      //   "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      //   "font-src 'self' https://fonts.gstatic.com",
      //   "img-src 'self' data: blob:",
      //   "connect-src 'self' https://*.supabase.co https://*.supabase.in https://vitals.vercel-insights.com",
      //   "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      //   "form-action 'self'",
      //   "object-src 'none'",
      //   "upgrade-insecure-requests",
      // ].join("; ");
      // return [{
      //   source: "/:path*",
      //   headers: [
      //     { key: "Content-Security-Policy", value: cspDev },
      //     { key: "X-Frame-Options", value: "DENY" },
      //     { key: "X-Content-Type-Options", value: "nosniff" },
      //     { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      //     { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      //   ],
      // }];
    }

    // Production: strict CSP (no unsafe-eval, no inline script except CSS inline)
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://vitals.vercel-insights.com",
      "script-src 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }];
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;

