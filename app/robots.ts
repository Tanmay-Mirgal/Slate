import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Private screens (/dashboard, /canvas/*, /auth) are deliberately NOT disallowed here: they are kept out of the
// index with an `X-Robots-Tag: noindex` header (next.config.ts), and Google can only see that header if it may crawl
// the URL. Only the JSON API has no reason to be fetched. Never block /_next/: Google needs the JS and CSS to render.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
