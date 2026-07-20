import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"} https://js.stripe.com https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(production
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/vanita-stock-review/[[...asset]]": ["./projects/vanita-stock/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
