import { MARKETING_PAGES, marketingPageBySlug } from "@/lib/marketing-pages";
import { renderOgCard } from "@/lib/og";
import { OG_SIZE } from "@/lib/seo";

// One share card per keyword page, drawn from the same data as the page and rendered once at build time.
export const alt = "Slate: AI architecture diagrams and a real-time whiteboard for software teams";
export const size = { ...OG_SIZE };
export const contentType = "image/png";
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETING_PAGES.map(({ slug }) => ({ slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const page = marketingPageBySlug((await params).slug);
  return renderOgCard(page?.og ?? { lines: ["Think.", "Draw.", "Collaborate."], sub: "AI architecture diagrams on a real-time whiteboard.", chips: ["Slate"] });
}
