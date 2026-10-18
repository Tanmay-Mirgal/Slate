<div align="center">
  <img src="public/logo.svg" alt="Slate Logo" width="96" />
  <h1>Slate</h1>
  <p><strong>An infinite canvas for software teams: draw it, generate it with AI, or write it as code.</strong></p>
  <p>
    <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" /></a>
    <a href="https://convex.dev"><img src="https://img.shields.io/badge/Convex-Realtime-orange" alt="Convex" /></a>
    <a href="https://clerk.com"><img src="https://img.shields.io/badge/Auth-Clerk-6C47FF?logo=clerk" alt="Clerk" /></a>
    <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/AI-NVIDIA%20NIM-76b900?logo=nvidia" alt="NVIDIA NIM" /></a>
  </p>
</div>

---

## What it does

| | |
| :-- | :-- |
| **Whiteboard** | Custom canvas engine: 11 shapes, smart connectors (elbow / curve / straight) that route around other nodes, text, sticky notes, frames, pen + highlighter, images, rotate / resize / group / lock, alignment guides, grid snapping, minimap, dark & light themes. |
| **Icon library** | 170+ real product logos (Postgres, Kafka, Next.js…), 40 AWS / GCP / Azure services, and all ~2,000 Lucide glyphs. Drop them as node cards or bare icons; search understands aliases (`k8s`, `postgres`). |
| **AI diagrams** | Describe anything. Slate AI (NVIDIA-hosted models) produces a structured graph, and the browser lays it out with ELK so nothing overlaps. Follow-up prompts edit the same diagram in place. Architecture, flowchart, ER, mind map and sequence diagrams. |
| **Diagram as code** | Eraser-style text syntax (`API gateway > Orders: gRPC`, groups, icons, colours) with the same layout engine. Round-trips: any selection can be turned back into code. 10 built-in templates. |
| **Collaboration** | Live cursors with names, teammates' selections, live drag previews, "anyone with the link" sharing (view / edit), workspace roles, per-element sync so edits never overwrite each other. |
| **Export** | PNG (1-4x, transparent), SVG, JSON; import JSON; copy PNG to clipboard. |
| **Docs** | Rich-text document (Tiptap) next to the canvas. The split view has a draggable divider (20-80%, remembered), one-click layout presets, a reading header (word count, copy / download Markdown) and "insert canvas snapshot into document". |
| **Import code** | Paste a `docker-compose.yml`, SQL schema or folder tree: Slate parses it exactly (no AI) into a diagram **and** writes the documentation (service table, port map, environment requirements, ER tables) into the document. Any other code goes through Slate AI. |
| **Cloud cost (FinOps)** | A live "estimated cloud cost / month" badge for the AWS / GCP / Azure services on the board, with cost-saving tips. Pro adds the per-component breakdown and CSV export. |
| **Traffic simulator** | Animated packets flow along your arrows (amber for async links) and components many others depend on, with no redundancy, get a pulsing single-point-of-failure badge. |
| **Interview mode** | 45-minute countdown, requirement checklist, back-of-the-envelope scale calculator and an architecture review (instant structural check, or a written AI review). |
| **Billing** | Free / Pro / Team plans paid through Razorpay (checkout, signed verification, webhooks). Free: 3 boards and 15 AI credits a month. |

A free, no-account board lives at **`/playground`** (stored in your browser).

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in the values (see below)
npx convex dev                 # terminal 1: deploys convex/ and watches it
npm run dev                    # terminal 2: http://localhost:3000
```

> **After pulling this version you must run `npx convex dev` (or `npx convex deploy` for prod).**
> It adds tables (`elements`, `liveSessions`, `rateLimits`), indexes, cron jobs and replaces the old
> `slates.addElement/updateElement/...` functions. Existing boards are upgraded automatically the first
> time an editor opens them (see *Upgrading existing boards* below).

### Environment

See [`.env.example`](.env.example) for the full list. The ones that matter most:

| Variable | Purpose |
| :-- | :-- |
| `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` | Convex backend |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk auth. A Clerk **JWT template named `convex`** is required (also used to authenticate the AI route to Convex). |
| `NVIDIA_API_KEY` | **AI generation.** Free key from <https://build.nvidia.com> → profile → API Keys. Without it AI is disabled and the panel offers templates instead. |
| `NVIDIA_MODELS` | Optional comma-separated model chain, first = preferred. |
| `AI_RATE_LIMIT_PER_HOUR` | Optional per-user cap (default 40; plus 6/minute burst). |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay checkout, payment verification and webhooks. |
| `BILLING_SYNC_SECRET` | 16+ random characters, set **identically** in `.env.local` and in the Convex dashboard. Lets the server (and only the server) change a user's plan. |
| `RAZORPAY_PLAN_{PRO,TEAM}_{MONTHLY,ANNUAL}` | Optional Razorpay plan ids for recurring billing. Without them checkout falls back to a one-time order for the first period. |

### AI models (NVIDIA)

Groq has been replaced by NVIDIA NIM's OpenAI-compatible API. The default chain, best first:

1. `nvidia/nemotron-3-ultra-550b-a55b`: highest capability, great at structured diagram JSON
2. `nvidia/nemotron-3.5-super-vl-120b-a12b`: fast, low latency
3. `nvidia/nemotron-3-super-120b-a12b`: efficient fallback MoE

Each request tries a model, feeds failures back for one repair pass, then falls through to the next model on
timeouts / 5xx / rate limits. Check which work for **your** key (free-tier availability varies):

```bash
npm run ai:check            # model availability, latency, JSON compliance
npm run ai:check -- --full  # also runs a real end-to-end generation
```

---

## How it works

```mermaid
graph LR
  B[Browser<br/>Canvas engine + React UI] -- "elements.apply (batched)" --> C[(Convex)]
  C -- "4 sharded subscriptions" --> B
  B -- "cursors (throttled)" --> C
  B -- "prompt" --> R[Next.js /api/ai/generate]
  R -- "auth + rate limit" --> C
  R -- "stream" --> N[NVIDIA NIM]
  R -- "validated graph" --> B
  B -- "ELK layout (in-browser)" --> B
```

* **One row per element**, split over 4 shards, instead of one JSON blob per board. A drag is *one* small
  mutation, concurrent editors never overwrite each other, and a change re-sends ~1/4 of the board, not all of it.
* **Layout runs in the browser.** The server only proxies the model and validates JSON, so AI cost scales with
  model usage, not server CPU.
* **Presence is throttled and coalesced**: at most one in-flight update per tab, with the send rate backing off
  as a room grows; remote cursors are interpolated client-side so low update rates still look smooth.
* **Access control lives in one resolver** (`convex/access.ts`): workspace roles, legacy owners and link sharing.

Details, trade-offs and the upgrade path to a dedicated realtime service are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Upgrading existing boards

Boards saved by the previous version (the whole canvas in one JSON string) are converted to per-element rows
the first time an editor opens them (`lib/canvas/legacy.ts` → `elements.importLegacy`). Viewers see the converted
board immediately; nothing is lost. Images larger than 250 KB that were stored inline are skipped with a notice.

---

## Keyboard shortcuts

Press **`?`** in the app. Highlights: `V` select · `H` hand · `R`/`O`/`D` shapes · `A` arrow · `L` line · `P` pen ·
`T` text · `N` sticky · `F` frame · `E` eraser · `Ctrl+K` command palette · `Tab` add connected node ·
`Ctrl+D` duplicate · `Ctrl+G` group · `Shift+1` fit.

---

## Project layout

```
app/                 routes: dashboard, canvas/[id], playground, api/ai/*, api/billing/razorpay/*
components/canvas/   React UI: toolbar, properties, library, export, share, text editor, cursors
components/ai-panel/ AI drawer (prompting, progress, edit-in-place, code view, import code)
components/billing/  pricing modal (Razorpay Standard Checkout)
components/dashboard/ workspace switcher, usage meter, template rail, board cards, settings
lib/canvas/          engine: store + history, renderer, router, hit-testing, snapping, export
lib/diagram/         graph model, ELK layout, DSL parser/serializer, templates
lib/ai/              NVIDIA client, prompts, JSON repair, rate limiting
lib/billing/         plans, tier limits (board cap, AI credits), Razorpay helpers and signatures
lib/finops/          benchmark prices and the cost estimator
lib/simulation/      dependency graph + single-point-of-failure detection
lib/import/          docker-compose / SQL / folder-tree importers and the documentation they write
lib/interview/       timer, checklist, scale calculator, review rubric
convex/              schema, elements, presence, access control, uploads, cron sweepers
tests/               vitest: engine, router, layout (overlap-free), DSL, AI plumbing, Convex backend
```

## Development

```bash
npm test              # 250+ unit + backend tests (Convex logic runs in convex-test's in-memory runtime)
npm run typecheck
npm run lint
npm run build
npm run icons:build   # regenerate the brand-logo set from simple-icons
```

---

## Status & known limitations

Verified: typecheck, lint, production build, unit tests (including layout overlap checks on random 60-node
graphs and the Convex access rules), and the canvas interactions in a real browser via `/playground`.

Not verified in this environment (needs your credentials): signed-in flows against a live Convex/Clerk
deployment, and real model output from NVIDIA (the NVIDIA plumbing is tested against a mocked streaming API).

Not built (compared with Eraser): comments / @mentions, version history, PDF export, Mermaid import, embeds,
CRDT co-editing of the rich-text *Doc* view (it saves last-writer-wins). Cursor traffic goes through the database,
which is great for typical team sizes (≲ 25 people per board); beyond that, plug a dedicated realtime transport
into `PresenceChannel` (see ARCHITECTURE.md).

Billing: payments are verified server-side (HMAC-SHA256 signature, then the order or subscription is fetched
from Razorpay) and plans are written to Convex only with `BILLING_SYNC_SECRET`. Verified here with unit tests and
Convex backend tests; a real payment needs your Razorpay test keys. Cancelling a subscription is done from the
Razorpay dashboard for now (the webhook keeps access until the paid period ends).
