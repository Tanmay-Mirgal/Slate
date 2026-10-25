import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

// Signed-in screens, shared boards and the API must never show up in search results. A header (rather than a meta tag)
// covers client-rendered pages too; robots.txt leaves these URLs crawlable so Google can actually read this header.
// /auth itself is public and indexed (people search "slate login"); only Clerk's steps below it (sso-callback,
// verify-email-address...) are private, and the share-image routes next to the page stay indexable.
const noindexHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
const NOINDEX_SOURCES = [
  "/dashboard/:path*",
  "/canvas/:path*",
  "/auth/:path((?!opengraph-image|twitter-image).+)",
  "/sign-in/:path*",
  "/sign-up/:path*",
  "/api/:path*",
];

const nextConfig: NextConfig = {
  // Dev-only badge: keep it clear of the canvas controls in the bottom-left.
  devIndicators: { position: "bottom-right" },
  poweredByHeader: false,
  compress: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...NOINDEX_SOURCES.map((source) => ({ source, headers: noindexHeaders })),
      // public/ files are served with max-age=0 by default, which re-downloads the 3.5 MB demo video on every visit.
      {
        source: "/:all*(svg|jpg|jpeg|png|webp|mp4)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      // Board state changes constantly; never let a CDN cache API responses (uploaded images, which never change, set their own caching).
      { source: "/api/:path((?!files/).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
