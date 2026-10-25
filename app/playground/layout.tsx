import type { Metadata } from "next";
import { SITE_NAME, absoluteUrl } from "@/lib/seo";

const TITLE = "Free Online Whiteboard & Architecture Diagram Maker";
const DESCRIPTION =
  "Try Slate in your browser with no account. Draw architecture diagrams and flowcharts on an infinite canvas, then sign up to sync, share and use AI.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/playground" },
  // The share image comes from this segment's opengraph-image / twitter-image files.
  openGraph: { type: "website", siteName: SITE_NAME, url: absoluteUrl("/playground"), title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION },
};

export default function PlaygroundLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* The board itself is client-only, so give crawlers and screen readers a heading that says what this page is. */}
      <h1 className="sr-only">{TITLE}</h1>
      <p className="sr-only">
        Slate playground: a free whiteboard that runs in your browser. Add shapes, connectors and sticky notes to sketch a system design.
      </p>
      {children}
    </>
  );
}
