import type { MetadataRoute } from "next";
import { INDEXABLE_ROUTES, absoluteUrl } from "@/lib/seo";

// Only public, indexable pages. Sign-in, dashboard and shared boards are private and stay out.
// No `lastModified` on purpose: Google ignores a lastmod that isn't consistently accurate, so a made-up date is worse than none.
export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXABLE_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    changeFrequency,
    priority,
  }));
}
