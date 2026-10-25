import { renderOgCard } from "@/lib/og";
import { OG_ALT, OG_SIZE } from "@/lib/seo";

// Home page share card; each other public page has its own opengraph-image next to its page.
export const alt = OG_ALT;
export const size = { ...OG_SIZE };
export const contentType = "image/png";

export default function Image() {
  return renderOgCard({
    lines: ["Think.", "Draw.", "Collaborate."],
    sub: "AI architecture diagrams and markdown docs on one real-time whiteboard.",
    chips: ["AI diagrams", "Diagram as code", "Live collaboration"],
  });
}
