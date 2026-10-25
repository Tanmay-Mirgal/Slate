import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingPage } from "@/components/marketing/MarketingPage";
import { MARKETING_PAGES, marketingPageBySlug } from "@/lib/marketing-pages";
import { SITE_NAME, absoluteUrl, jsonLd, pageJsonLd } from "@/lib/seo";

// The public keyword pages (/ai-architecture-diagram-generator ...). Anything else at the top level is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETING_PAGES.map(({ slug }) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = marketingPageBySlug((await params).slug);
  if (!page) return {};
  const path = `/${page.slug}`;
  const title = `${page.title} | ${SITE_NAME}`;
  // The share image comes from this segment's opengraph-image / twitter-image files.
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, url: absoluteUrl(path), title, description: page.description },
    twitter: { card: "summary_large_image", title, description: page.description },
  };
}

export default async function KeywordPage({ params }: Props) {
  const page = marketingPageBySlug((await params).slug);
  if (!page) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(pageJsonLd({ path: `/${page.slug}`, title: page.title, description: page.description, breadcrumb: page.breadcrumb, faqs: page.faqs })),
        }}
      />
      <MarketingPage page={page} />
    </>
  );
}
