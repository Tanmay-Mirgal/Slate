import { PLANS, formatInr } from "@/lib/billing/plans";

/**
 * Single source of truth for everything search engines and link previews read about Slate:
 * the canonical origin, titles, descriptions and the schema.org (JSON-LD) graph.
 */

/** Canonical origin, no trailing slash. Override with NEXT_PUBLIC_SITE_URL for previews / staging. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://slate.tanmaymirgal.dev").replace(/\/+$/, "");

export const SITE_NAME = "Slate";
/** Brand-first title: wins "slate" brand queries and still carries the money keywords. */
export const SITE_TITLE = "Slate - AI Architecture Diagram Maker & Online Whiteboard";
/** Under 160 characters so Google shows it whole. */
export const SITE_DESCRIPTION =
  "Slate is an online whiteboard for system design. Generate architecture diagrams with AI, write docs next to them, and collaborate in real time. Free to start.";
export const SITE_KEYWORDS = [
  "architecture diagram maker",
  "AI diagram generator",
  "system design tool",
  "online whiteboard",
  "collaborative whiteboard",
  "diagram as code",
  "code to diagram",
  "docker compose to diagram",
  "cloud architecture diagram",
  "system design interview",
  "markdown documentation",
  "real-time collaboration",
];

/** The share card (app/opengraph-image.tsx). Pages that define their own openGraph must reference it, or they lose the image. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_ALT = "Slate: AI architecture diagrams, an infinite whiteboard and markdown docs in one workspace";
export const OG_IMAGE = { url: "/opengraph-image", ...OG_SIZE, alt: OG_ALT };
export const TWITTER_IMAGE = { url: "/twitter-image", ...OG_SIZE, alt: OG_ALT };

/** Profiles that prove the brand is one entity (schema.org `sameAs`). Add Product Hunt, X, LinkedIn... as they exist. */
export const SAME_AS = ["https://github.com/Tanmay-Mirgal/Slate"];

export const absoluteUrl = (path = "/") => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

/** Pages Google may index, shared by sitemap.ts so the sitemap can never drift from the real routes. */
export const INDEXABLE_ROUTES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/playground", changeFrequency: "monthly", priority: 0.7 },
] as const;

/** The 25 s how-to on the landing page. Dates are ISO 8601; the duration is PT<seconds>S. */
export const SHOWCASE = {
  name: "How to use Slate in five steps",
  description:
    "Start from a template, describe a diagram to Slate AI, refine it, import code to get the docs, and share one link with your team.",
  thumbnail: "/slate-how-to-poster.jpg",
  contentUrl: "/slate-how-to.mp4",
  uploadDate: "2026-10-25",
  duration: "PT25S",
} as const;

export interface Faq {
  question: string;
  answer: string;
}

/** Visible on the landing page and mirrored into FAQPage JSON-LD, so what Google reads is what people see. */
export const FAQS: Faq[] = [
  {
    question: "What is Slate?",
    answer:
      "Slate is an infinite canvas for software teams. You draw architecture diagrams, generate them from a text prompt with AI, or write them as code, and keep the documentation in a markdown editor right beside the board. Everyone on the team can edit the same board live.",
  },
  {
    question: "How does the AI architecture diagram generator work?",
    answer:
      "Describe a system in plain language, for example \"Uber low-level design\" or \"e-commerce microservices\". Slate AI returns a structured graph and lays it out automatically so nothing overlaps. Follow-up prompts edit the same diagram in place. It handles architecture, flowchart, ER, mind map and sequence diagrams.",
  },
  {
    question: "Can I turn code into a diagram?",
    answer:
      "Yes. Paste a docker-compose.yml, a SQL schema or a folder tree and Slate parses it exactly, without using AI credits, into a diagram and writes the matching documentation: service table, port map, environment requirements and ER tables. Any other code is handled by Slate AI.",
  },
  {
    question: "Is Slate free?",
    answer: `Yes. The ${PLANS.free.name} plan is free forever and includes ${PLANS.free.features.slice(0, 2).join(" and ")}. Pro is ${formatInr(PLANS.pro.monthly)} a month and Team is ${formatInr(PLANS.team.monthly)} per seat a month. You can also open the playground, a free board that needs no account.`,
  },
  {
    question: "Can I try Slate without signing up?",
    answer:
      "Yes. The playground is a full whiteboard that runs in your browser with no account. Your board is saved on your device; sign up when you want it synced, shared or generated with AI.",
  },
  {
    question: "Can my team collaborate in real time?",
    answer:
      "Yes. Slate shows live cursors with names, teammates' selections and live drag previews. Share a board with \"anyone with the link\" (view or edit) or invite people to a workspace with roles. Edits sync per element, so two people never overwrite each other.",
  },
  {
    question: "What can I export from Slate?",
    answer: `PNG (1x to 4x, transparent background), SVG and JSON. ${PLANS.pro.name} adds 4K HD export and a per-component cloud cost breakdown with CSV export.`,
  },
];

/** `JSON.stringify` for a <script type="application/ld+json">: `<` is escaped so content can never close the tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#software`;
const PAGE_ID = `${SITE_URL}/#webpage`;

/** Schema.org graph for the home page: who we are, the site, the product + prices, the demo video and the FAQ. */
export function homeJsonLd() {
  const offer = (name: string, paise: number, extra: Record<string, unknown> = {}) => ({
    "@type": "Offer",
    name,
    price: (paise / 100).toFixed(2),
    priceCurrency: "INR",
    url: absoluteUrl("/#pricing"),
    availability: "https://schema.org/InStock",
    ...extra,
  });

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: SITE_NAME,
        url: SITE_URL,
        logo: { "@type": "ImageObject", url: absoluteUrl("/icons/icon-512.png"), width: 512, height: 512 },
        image: absoluteUrl("/icons/icon-512.png"),
        description: SITE_DESCRIPTION,
        sameAs: SAME_AS,
      },
      {
        // Google reads `name` / `alternateName` from here for the site name shown above the blue link.
        "@type": "WebSite",
        "@id": SITE_ID,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: ["Slate Whiteboard", "Slate AI Diagrams"],
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "WebPage",
        "@id": PAGE_ID,
        url: SITE_URL,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": SITE_ID },
        about: { "@id": APP_ID },
        primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl("/opengraph-image") },
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        "@id": APP_ID,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Diagramming and whiteboard software",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript. Works in current Chrome, Edge, Firefox and Safari.",
        image: absoluteUrl("/opengraph-image"),
        screenshot: absoluteUrl(SHOWCASE.thumbnail),
        publisher: { "@id": ORG_ID },
        featureList: [
          "Infinite whiteboard canvas with smart connectors, shapes, sticky notes and frames",
          "AI architecture diagram generation from a text prompt",
          "Diagram as code with a text syntax and 10 built-in templates",
          "Import docker-compose, SQL schemas and folder trees into diagrams and documentation",
          "Real-time collaboration with live cursors and shareable links",
          "Markdown documentation beside the canvas",
          "Live estimated cloud cost (FinOps) for AWS, GCP and Azure services",
          "Traffic simulator and single-point-of-failure detection",
          "System design interview mode with timer and architecture review",
          "Export to PNG, SVG and JSON",
        ],
        offers: [
          offer(PLANS.free.name, PLANS.free.monthly),
          offer(`${PLANS.pro.name} (monthly)`, PLANS.pro.monthly),
          offer(`${PLANS.team.name} (per seat, monthly)`, PLANS.team.monthly),
        ],
      },
      {
        "@type": "VideoObject",
        name: SHOWCASE.name,
        description: SHOWCASE.description,
        thumbnailUrl: absoluteUrl(SHOWCASE.thumbnail),
        contentUrl: absoluteUrl(SHOWCASE.contentUrl),
        uploadDate: SHOWCASE.uploadDate,
        duration: SHOWCASE.duration,
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      },
    ],
  };
}
