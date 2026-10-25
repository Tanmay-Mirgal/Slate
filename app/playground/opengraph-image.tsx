import { renderOgCard } from "@/lib/og";
import { OG_SIZE } from "@/lib/seo";

export const alt = "Slate playground: a free online whiteboard and architecture diagram maker";
export const size = { ...OG_SIZE };
export const contentType = "image/png";

export default function Image() {
  return renderOgCard({
    lines: ["Free Online", "Whiteboard"],
    sub: "Draw architecture diagrams in your browser. No sign-up.",
    chips: ["No account", "Real icons", "Saved on your device"],
  });
}
