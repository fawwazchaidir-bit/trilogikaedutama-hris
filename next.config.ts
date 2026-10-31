import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers applied to every response.
 * CSP: Next.js needs inline scripts for hydration, so 'unsafe-inline' is kept for scripts/styles;
 * everything else (frames, objects, base-uri, form targets) is locked down.
 * Permissions-Policy: geolocation=(self) untuk absensi berbasis lokasi/foto bercap lokasi dan camera=(self) untuk foto
 * absensi (opsional; izin tetap diminta browser per pengguna); mikrofon tetap dimatikan.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "object-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // "standalone" hanya untuk image Docker (NEXT_OUTPUT=standalone); `next start` biasa dipakai di VPS/CI.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  // opentype.js dimuat sebagai paket eksternal (CJS) — build ESM-nya tidak punya ekspor default dan dianalisis ketat oleh Turbopack.
  serverExternalPackages: ["@react-pdf/renderer", "@prisma/client", "exceljs", "opentype.js"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
