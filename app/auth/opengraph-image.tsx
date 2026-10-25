import { renderOgCard } from "@/lib/og";
import { OG_SIZE } from "@/lib/seo";

export const alt = "Log in or sign up to Slate";
export const size = { ...OG_SIZE };
export const contentType = "image/png";

export default function Image() {
  return renderOgCard({
    lines: ["Log in to", "Slate"],
    sub: "Sync your boards, generate AI diagrams and collaborate in real time.",
    chips: ["Free plan", "AI diagrams", "Live collaboration"],
  });
}
