import type { MetadataRoute } from "next";
import { MARKETING_PAGES } from "@/lib/marketing-pages";
import { INDEXABLE_ROUTES, absoluteUrl } from "@/lib/seo";

// Only public, indexable pages. Sign-in follow-ups, the dashboard and shared boards are private and stay out.
// No `lastModified` on purpose: Google ignores a lastmod that isn't consistently accurate, so a made-up date is worse than none.
export default function sitemap(): MetadataRoute.Sitemap {
  const keywordPages = MARKETING_PAGES.map((p) => ({ path: `/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.8 }));
  return [...INDEXABLE_ROUTES, ...keywordPages].map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    changeFrequency,
    priority,
  }));
}
