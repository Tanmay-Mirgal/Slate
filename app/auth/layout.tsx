import type { Metadata } from "next";
import { SITE_NAME, absoluteUrl } from "@/lib/seo";

const TITLE = "Log In or Sign Up";
const DESCRIPTION = "Log in to Slate or create a free account to generate AI architecture diagrams, sync your boards and collaborate with your team in real time.";

// /auth is the one public sign-in page, so people searching "slate login" can land on it. Clerk's follow-up steps
// (/auth/sso-callback, /auth/verify-email-address...) stay out of the index via an X-Robots-Tag header in next.config.ts.
// The share image comes from this segment's opengraph-image / twitter-image files.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/auth" },
  openGraph: { type: "website", siteName: SITE_NAME, url: absoluteUrl("/auth"), title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION },
};

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
