import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { SITE_DESCRIPTION, SITE_TITLE, homeJsonLd, jsonLd } from "@/lib/seo";

// The landing UI is a client component (auth state, modals), so the metadata and structured data live here.
export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(homeJsonLd()) }} />
      <LandingPage />
    </>
  );
}
