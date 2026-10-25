import { PLANS, formatInr } from "@/lib/billing/plans";
import type { Faq } from "@/lib/seo";
import type { OgCard } from "@/lib/og";

/**
 * The public keyword pages (/<slug>). One entry = one indexable page: app/[slug] renders it, sitemap.ts lists it,
 * its share image and JSON-LD come from the same data. Copy must stay true to what the product does (see README).
 */
export interface MarketingPage {
  slug: string;
  /** <title> without the " | Slate" suffix the root layout's template adds. */
  title: string;
  /** Under 160 characters. */
  description: string;
  breadcrumb: string;
  eyebrow: string;
  h1: string;
  lede: string;
  heroAlt: string;
  /** Example inputs shown as chips under the hero. */
  prompts?: string[];
  stepsHeading: string;
  steps: { title: string; body: string }[];
  example?: { heading: string; intro: string; filename: string; code: string; result: string[] };
  featuresHeading: string;
  features: { title: string; body: string }[];
  faqs: Faq[];
  /** Slugs of sibling pages to link to. */
  related: string[];
  og: OgCard;
}

const credits = (n: number) => n.toLocaleString("en-US");
const pricingLine = `The ${PLANS.free.name} plan is free forever. ${PLANS.pro.name} is ${formatInr(PLANS.pro.monthly)} a month and ${PLANS.team.name} is ${formatInr(PLANS.team.monthly)} per seat a month.`;

export const MARKETING_PAGES: MarketingPage[] = [
  {
    slug: "ai-architecture-diagram-generator",
    title: "AI Architecture Diagram Generator: Text to Diagram",
    description: "Describe a system in plain English and Slate AI draws an editable architecture diagram, auto-laid-out and ready to share. Try the free playground.",
    breadcrumb: "AI Architecture Diagram Generator",
    eyebrow: "AI diagrams",
    h1: "AI Architecture Diagram Generator",
    lede: "Describe a system in plain language and Slate AI turns it into a clean, editable diagram on an infinite canvas. Skip the hour of dragging boxes: generate it, then refine it by chatting or by hand.",
    heroAlt: "A Slate board with an architecture diagram on the left and its generated documentation on the right",
    prompts: ["Uber low-level design", "E-commerce microservices", "RAG chatbot with a vector database", "CI/CD pipeline for a monorepo"],
    stepsHeading: "From a sentence to a diagram in four steps",
    steps: [
      { title: "Describe the system", body: "Type what you want to build, such as “Uber low-level design” or “e-commerce microservices”. Slate AI returns a structured graph of components and the connections between them." },
      { title: "Get a clean layout", body: "The graph is laid out in your browser with the ELK layout engine, so boxes don't overlap and arrows route around each other." },
      { title: "Refine it in place", body: "Ask a follow-up like “put a Redis cache between the API and the database” and the same diagram is edited, not regenerated. You can also drag, restyle and connect anything by hand." },
      { title: "Document and share", body: "Write the explanation in the markdown editor beside the board, then share one link that opens the board for viewing or editing." },
    ],
    example: {
      heading: "Prefer text? Diagram as code",
      intro: "Every diagram can be written as plain text and turned back into one. The syntax is compact enough to keep in a pull request.",
      filename: "checkout.slate",
      code: `title Checkout
type architecture
direction right

Edge [color: blue] {
  CDN [icon: cloudflare]
  API gateway [subtitle: "Rate limiting"]
}
Web app [icon: nextdotjs] > CDN > API gateway: HTTPS
API gateway <> Redis
Orders --> Kafka: events`,
      result: ["Groups, icons and subtitles in one line each", "Arrows, back-arrows, double arrows and dashed links", "Any selection on the canvas can be turned back into code"],
    },
    featuresHeading: "More than a prompt box",
    features: [
      { title: "Five diagram types", body: "Architecture, flowchart, entity-relationship, mind map and sequence diagrams from the same prompt box." },
      { title: "Real product icons", body: "170+ product logos such as Postgres, Kafka and Next.js, plus AWS, GCP and Azure service icons. Search understands aliases like k8s and postgres." },
      { title: "Live cloud cost", body: "A running estimate of the monthly cost of the AWS, GCP and Azure services on your board, with cost-saving tips." },
      { title: "Architecture review", body: "Get an instant structural check of the diagram, or a written review from Slate AI." },
      { title: "Real-time collaboration", body: "Live cursors with names, shared selections and live drag previews, so a design review can happen on the board itself." },
      { title: "Export anywhere", body: "Download PNG (1x to 4x, transparent), SVG or JSON, or copy the image straight to your clipboard." },
    ],
    faqs: [
      { question: "Is the AI architecture diagram generator free?", answer: `Yes, to start. The ${PLANS.free.name} plan includes ${PLANS.free.limits.aiCreditsMonthly} AI diagram credits a month. ${PLANS.pro.name} (${formatInr(PLANS.pro.monthly)} a month) includes ${credits(PLANS.pro.limits.aiCreditsMonthly)} and ${PLANS.team.name} (${formatInr(PLANS.team.monthly)} per seat a month) includes ${credits(PLANS.team.limits.aiCreditsMonthly)}.` },
      { question: "Can I edit the diagram after the AI generates it?", answer: "Yes. The result is a normal Slate board, so every shape, icon and connector is editable. Follow-up prompts also edit the existing diagram instead of starting over." },
      { question: "What kinds of diagrams can it generate?", answer: "Architecture diagrams, flowcharts, ER diagrams, mind maps and sequence diagrams." },
      { question: "Do I need an account to try it?", answer: "You can sketch on the free playground without an account. AI generation needs a free Slate account so credits can be tracked." },
      { question: "Can I turn the diagram into documentation?", answer: "Yes. Every board has a markdown document beside the canvas, and you can insert a snapshot of the diagram into it and copy or download the result as markdown." },
    ],
    related: ["docker-compose-to-diagram", "system-design-whiteboard"],
    og: { lines: ["AI Architecture", "Diagram Generator"], sub: "Describe a system, get an editable diagram.", chips: ["Text to diagram", "Diagram as code", "Free to start"] },
  },
  {
    slug: "docker-compose-to-diagram",
    title: "Docker Compose to Diagram: Visualize Your Stack",
    description: "Paste a docker-compose.yml and Slate draws the architecture diagram and writes the docs: service table, port map and dependencies. Parsed instantly, no AI.",
    breadcrumb: "Docker Compose to Diagram",
    eyebrow: "Import code",
    h1: "Docker Compose to Diagram",
    lede: "Paste a docker-compose.yml and get an architecture diagram of your services, plus the documentation that belongs beside it. Compose files are read by Slate's own parser, so the result is exact, instant and uses no AI credits.",
    heroAlt: "Slate showing a diagram of six Docker Compose services next to the generated service table",
    stepsHeading: "How to convert docker-compose.yml to a diagram",
    steps: [
      { title: "Open a board", body: "Sign in (a free account is enough), open or create a board and open the import-code dialog." },
      { title: "Paste your file", body: "Paste a docker-compose.yml. Slate also accepts SQL schemas and directory trees, up to 60,000 characters." },
      { title: "Get the diagram", body: "Each service becomes a node with a product icon recognised from its image, and depends_on becomes an arrow." },
      { title: "Get the docs", body: "The document beside the board is filled in automatically: an overview, a table of services and the details of each one." },
    ],
    example: {
      heading: "A compose file in, a diagram and docs out",
      intro: "This six-service stack is the one used in Slate's walkthrough video.",
      filename: "docker-compose.yml",
      code: `services:
  web:
    image: nginx:1.27-alpine
    ports: ["8080:80"]
    depends_on: [api]
  api:
    build: ./api
    ports: ["3000:3000"]
    depends_on: [db, cache]
  worker:
    build: ./worker
    depends_on: [queue, db]
  db:
    image: postgres:16
  cache:
    image: redis:7
  queue:
    image: rabbitmq:3-management`,
      result: ["A diagram with web, api, worker, db, cache and queue connected by their dependencies", "An overview that says which services are reachable from the host and which stay internal to the Compose network", "A table of image or build context, published ports and dependencies for every service"],
    },
    featuresHeading: "Why teams use it for onboarding and reviews",
    features: [
      { title: "Exact, not guessed", body: "Compose files, SQL DDL and directory trees are parsed by Slate itself rather than by a language model, so the same input always gives the same diagram." },
      { title: "No AI credits", body: "Parsing these formats is free of AI credits. Other code can be imported through Slate AI, which does use a credit." },
      { title: "Docs that stay beside the diagram", body: "The generated documentation lives in the markdown editor next to the board. Copy it or download it as a .md file." },
      { title: "SQL schema to ER diagram", body: "Paste CREATE TABLE statements and get an entity-relationship diagram with the table documentation filled in." },
      { title: "Edit afterwards", body: "The import is a normal board. Move nodes, add a load balancer, group services into frames or restyle it for a slide." },
      { title: "Share one link", body: "Send teammates a view or edit link and review the stack together with live cursors." },
    ],
    faqs: [
      { question: "How do I convert docker-compose.yml to a diagram?", answer: "Open any Slate board, open the import-code dialog, paste your docker-compose.yml and confirm. Slate draws one node per service, connects them by depends_on and writes the service documentation beside the board." },
      { question: "Does it use AI to read my compose file?", answer: "No. Docker Compose files, SQL schemas and directory trees are parsed by Slate's own parser, not by an AI model, so it's instant and doesn't spend AI credits." },
      { question: "What else can I import?", answer: "SQL schemas become ER diagrams and directory trees become structure diagrams. Anything else, such as Kubernetes manifests, Terraform or application code, is drawn by Slate AI." },
      { question: "Is it free?", answer: `Yes. ${pricingLine} Importing needs a free account; the playground lets you sketch on a board without one.` },
      { question: "Can I export the diagram?", answer: "Yes. Export PNG (1x to 4x, transparent), SVG or JSON, or copy the image to your clipboard." },
    ],
    related: ["ai-architecture-diagram-generator", "system-design-whiteboard"],
    og: { lines: ["Docker Compose", "to Diagram"], sub: "Compose file in, diagram and docs out.", chips: ["Exact parser", "No AI credits", "Docs included"] },
  },
  {
    slug: "system-design-whiteboard",
    title: "System Design Whiteboard for Interviews and Teams",
    description: "A collaborative system design whiteboard with real product icons, AI diagrams, a traffic simulator and an interview timer. Start free in your browser.",
    breadcrumb: "System Design Whiteboard",
    eyebrow: "System design",
    h1: "System Design Whiteboard",
    lede: "A whiteboard built for architecture, not stick figures. Drop real Postgres, Kafka and AWS icons, connect them with smart connectors, simulate traffic and write the design doc beside it, alone or with your team in real time.",
    heroAlt: "A Slate system design board with services, databases and a cache next to a markdown design document",
    prompts: ["URL shortener", "Chat application", "Rate limiter", "Video streaming platform"],
    stepsHeading: "Everything a system design session needs, on one board",
    steps: [
      { title: "Start from a template", body: "Begin with a template such as microservices e-commerce, an AWS three-tier web app, an event-driven order system, a RAG assistant or real-time chat, or from a blank canvas." },
      { title: "Draw with real components", body: "Add product logos, AWS, GCP and Azure services and Lucide icons as node cards. Connectors in elbow, curve or straight style route around other nodes." },
      { title: "Test the design", body: "Run the traffic simulator to watch requests flow along your arrows and see which components are single points of failure." },
      { title: "Write it up and share", body: "Explain trade-offs in the markdown document next to the canvas, then share a link for the interviewer or your team." },
    ],
    featuresHeading: "Built for the way engineers design systems",
    features: [
      { title: "Interview mode", body: "A 45-minute countdown, a requirement checklist, a back-of-the-envelope scale calculator and an architecture review, either an instant structural check or a written AI review." },
      { title: "Traffic simulator", body: "Animated packets flow along your arrows (amber for async links), and components that many others depend on, with no redundancy, get a pulsing single-point-of-failure badge." },
      { title: "AI diagrams", body: "Describe a system and Slate AI draws a first version you can edit, so you start from a draft instead of an empty canvas." },
      { title: "Cloud cost estimate", body: "A live monthly cost for the AWS, GCP and Azure services on the board, with cost-saving tips." },
      { title: "Docs beside the canvas", body: "A rich-text document next to the board with a draggable split, a word count and one-click markdown copy or download." },
      { title: "Real-time collaboration", body: "Live cursors with names, teammates' selections and per-element sync, so two people editing never overwrite each other." },
    ],
    faqs: [
      { question: "What is a system design whiteboard?", answer: "A canvas for sketching how the parts of a software system fit together: services, databases, caches, queues and the traffic between them. Slate adds real product icons, simulation and documentation to that." },
      { question: "Can I use Slate to practice system design interviews?", answer: "Yes. Interview mode adds a 45-minute countdown, a requirement checklist, a scale calculator and an architecture review to any board." },
      { question: "Is there a free whiteboard with no sign-up?", answer: "Yes. The playground runs in your browser with no account and saves your board on your device. Sign up when you want it synced, shared or generated with AI." },
      { question: "Can my team collaborate on the same board?", answer: "Yes. Share an anyone-with-the-link URL (view or edit) or invite people to a workspace with roles. You'll see live cursors and selections as you work." },
      { question: "What does it cost?", answer: pricingLine },
    ],
    related: ["ai-architecture-diagram-generator", "docker-compose-to-diagram"],
    og: { lines: ["System Design", "Whiteboard"], sub: "Simulate traffic. Practice interviews.", chips: ["Interview mode", "Traffic simulator", "Live collaboration"] },
  },
];

export const marketingPageBySlug = (slug: string) => MARKETING_PAGES.find((p) => p.slug === slug);
