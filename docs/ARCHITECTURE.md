# Slate architecture

This document explains *why* the system is built the way it is, what scales, and where the limits are.

## 1. Canvas engine (`lib/canvas`)

The engine is plain TypeScript with no React in the hot path:

| Module | Responsibility |
| :-- | :-- |
| `store.ts` | Document state. Elements are immutable; edits are grouped into *gestures* (one undo step, one batched write). Remote snapshots never overwrite elements that are mid-gesture, queued or in flight. |
| `render.ts` | Draws the scene on a `<canvas>`: HiDPI, viewport culling, level-of-detail for tiny text, entry animations. Render-on-demand via `requestAnimationFrame`. |
| `router.ts` | Connector routing: side-aware anchors, orthogonal A* routing around obstacles with rounded corners, bezier curves. Routes saved by the AI layout are reused until an endpoint moves (`routeSig`). |
| `pointer.ts` | Pointer Events state machine (select / move / resize / rotate / marquee / draw / connect / erase / pinch). Pointer capture means drags never stick when the cursor leaves the canvas. |
| `scene.ts` | Memoised connector geometry. During a drag only connectors attached to moving elements are re-routed (`frozen`), so large boards stay smooth. |
| `snap.ts`, `handles.ts`, `hit.ts` | Alignment guides, selection handles, hit-testing for every shape. |
| `export.ts`, `svg.ts` | PNG / SVG / JSON. SVG reuses the same path strings as the canvas renderer. |

Why this fixes the glitches in the old canvas: it used React state for every pointer move, ignored
`devicePixelRatio` (blurry), re-created `Image` objects every frame, used mouse events (stuck drags), zoomed
around the origin rather than the cursor, and implemented undo by overwriting the entire board (which also
wiped collaborators' changes). Undo/redo now records *only the elements the user touched*.

### Document model

Every element is a small JSON object (`lib/canvas/types.ts`): `shape`, `text`, `sticky`, `frame`, `card`,
`icon`, `table`, `connector`, `pen`, `image`. Data coming from the network is passed through
`normalize.ts`, which whitelists fields, clamps numbers and caps collections, so one corrupt row cannot break a
board. Colours may be theme tokens (`ink`, `surface`, …) so boards adapt to light/dark.

## 2. Persistence and sync (`lib/db/`, `lib/server/`, `lib/client/`)

Data lives in MongoDB (Atlas). The browser never talks to it: every call goes to `POST /api/rpc`, which identifies the
caller from the Clerk session, validates the arguments (zod) and runs a *server function* declared with `query()` /
`mutation()`. Functions that must never be callable from the browser (plan changes, credit refunds, the snapshot job)
are plain exports and simply are not in the registry.

```
users        Clerk copy (name, avatar, emails) + billing state                 unique clerkId
workspaces / workspace_members / invites                                       unique (workspaceId, userId); one personal workspace per owner
slates       metadata: title, workspace, linkAccess, schemaVersion, elementSeq
elements     one row per element: (slateId, eid, seq, z, rev, data)            unique (slateId, eid); (slateId, seq)
             a deleted element stays as a marker (deleted: true) for a few hours
liveSessions cursors/selection/drafts (HTTP fallback only; the realtime server keeps them in memory)   TTL index
rateLimits   fixed-window counters per user and bucket                         TTL index
files        uploaded images (GridFS)
```

* **Batched writes.** `elements.apply` takes the ops of one gesture (≤ 500). Duplicate ops on an element are
  collapsed, unchanged rows are not rewritten (`rev` only bumps on real changes), and `slates.lastEdited` is
  touched at most every 30 s, so busy boards don't contend on the slate document.
* **A change feed.** Every write to a board takes the next number from the board's counter (`slates.elementSeq`, one
  atomic `$inc` per batch). `elements.sync({ slateId, since })` returns only the rows with a higher number, plus the ids
  deleted since; `since: 0` returns the whole board. Both transports below use it (the WebSocket on join and when
  reconnecting, HTTP on every poll). Rows are parsed once per `(eid, rev)`.
  * *Late writers.* Numbers are handed out before rows become visible, so a reader could see 11 before 10. Every read
    therefore also re-includes rows written in the last 5 s (clients ignore rows whose `rev` they already have).
  * *Deleted elements* stay as markers for 6 h so clients that were away less than that learn about the delete. A client
    that was away longer is told to reload the whole board (`slates.tombstoneFloor`).
  * *HTTP cadence (the fallback).* About 0.9 s while other people are on the board, 2.5 s when you are alone, paused
    while the tab is hidden, and immediately after your own edit is saved.
* **No snap-back.** While an element is being dragged, queued, or in flight, incoming server rows for it are
  ignored. After the write is acknowledged there's a short grace period before server state wins again.
* **Access** (`access.ts`): Admin/Editor → edit, Viewer → view, legacy owner → edit, and link sharing
  (`view` for anyone, `edit` for signed-in users). Queries return empty rather than throwing when access is
  revoked mid-session. Every mutation re-checks.
* **Uploads** go to GridFS (not inline data URIs) via `POST /api/files?slateId=…`, which checks edit rights, the claimed type,
  the file's real signature and the size (≤ 12 MB), and answers with `/api/files/<id>`. That route serves the image with
  `Cache-Control: immutable` and a CSP `sandbox` so an uploaded SVG can never run script.
* **Clerk ↔ MongoDB.** `/api/webhooks/clerk` mirrors user.created / updated / deleted. As a safety net the first request of any
  signed-in user creates their row from Clerk (`ensureUser`), and their default workspace on the dashboard's first load
  (`users.ensureProvisioned`), so a missing or late webhook can never leave an account that cannot create a board.
  `npm run clerk:sync` backfills everyone.

### Limits worth knowing

* One request ≤ 500 element ops; one element ≤ 250 KB. A full load of a very large board (tens of thousands of elements)
  is one big response; version snapshots refuse boards above 6,000 elements.
* A board's fan-out is *editors × viewers*: every change goes to everyone on it. That is the real scaling unit:
  **many boards scale horizontally** (MongoDB + stateless Next.js + realtime instances), but a *single* board with
  hundreds of simultaneous editors would need cursor throttling per recipient or a dedicated realtime service.

## 3. The realtime server (`lib/realtime/`, `scripts/realtime.ts`)

One long-running Node process holds a WebSocket to every browser on a board (a serverless host can't, so it is deployed
next to the app: `npm run realtime`, started with the app by `npm run dev`). The wire protocol is in
`lib/realtime/protocol.ts`; the browser end is `lib/client/realtime.ts` (`BoardSocket`).

```
browser ── join { slateId, token?, since, session } ──► verify the Clerk token, check access, add to the room
        ◄── joined { access, peers } ── sync { puts, dels, cursor }         the board, or what changed since `since`
        ── ops { id, ops } ──► runs the same elements.apply as the HTTP API (same checks) ──► ack { id } / error { id, message }
        ── presence { cursor, selection, draft, drag, tool } ──► relayed to the others as peer { ... }   (memory only)
        ◄── elements { puts, dels } pushed for every change by anybody · peer / left · access / revoked · nudge · hb
```

* **Where changes come from.** MongoDB change streams (elements with the full row; comments; a board's settings), so it
  doesn't matter who wrote a row: this process, the HTTP API, a script or another realtime instance. A row can be reported
  by several sources; an `(eid, rev)` memory pushes it once. Where change streams don't exist (a standalone mongod) the
  server polls each active board's changes every few hundred ms instead (`/health` reports which feed is in use). A
  dropped stream restarts itself with a catch-up, and a 30 s safety catch-up heals any missed event.
* **Auth.** The browser sends its Clerk session token in `join` (verified with `verifyToken`; with `REALTIME_ALLOWED_ORIGINS`
  set, only tokens issued to those origins count). No token = a signed-out visitor, who can join only boards with a link
  setting. Access is checked at join, on every write (it is `elements.apply`), after any change to the board's settings, and every
  30 s for everybody, so a removed member is dropped (`revoked`) and a downgraded one is told (`access`).
* **Safety.** Per-connection flood control (cursors beyond the allowance are dropped, anything else gets an error), message
  size and schema limits, a cap on connections per address, optional origin allow-list, ping/pong plus an app heartbeat so dead
  connections are dropped (and the browser reconnects if it hears nothing for 55 s), and slow consumers are skipped or closed
  instead of buffering without bound.
* **Browser side.** `BoardSocket` reconnects with backoff (and immediately when the network returns), re-joins with a fresh
  token and `since` = the last change it saw. `BoardFeed` (`lib/client/board-feed.ts`) holds the rows for whichever transport is
  live and makes sure a pushed change is never undone by a join reply that was read before it. While the socket is not open,
  `useBoardSync` and `useBoardPresence` run the HTTP paths (poll + `elements.apply` / `presence.*`), and stop them the moment it
  opens; a write that was in flight when the socket dropped is re-sent over HTTP. While nudges are available (comments, a
  board's title and sharing), those queries are only re-read on a slow safety timer.
* **Scaling out.** Board data and nudges work across instances (each one watches MongoDB). Cursors live in the memory of the
  instance a person is connected to, so send everybody on a board to the same instance (sticky by board id) or put a pub/sub in
  front. `PresenceChannel` (`lib/canvas/engine.ts`) is still the seam if you later swap in a hosted realtime service.

## 3b. Live cursors

Over the socket, `useBoardPresence` sends the engine's presence (cursor, selection, in-progress shape, drag preview) and shows
the peers the server relays; nothing is written to the database. (On the HTTP fallback each tab joins with a short-lived row,
`presence.join` / `update`, and the others poll `presence.list`.)

* Updates are **throttled by the engine** (`66 ms + 25 ms × peers`, capped at 400 ms), and the server drops cursor frames for
  a client that is not keeping up.
* Remote cursors are **interpolated per frame** in the DOM (`CursorsOverlay`), so low update rates still look
  smooth, and they are positioned in screen space (crisp at any zoom).
* Over the socket the server says exactly when someone leaves (`left`). On the HTTP fallback freshness uses the *client's*
  clock: a session whose `lastSeen` stops changing for 45 s disappears, and MongoDB's TTL index deletes the row ~90 s later.
* Teammates' **selection outlines**, **in-progress shapes** and **drag previews** ride on the same channel.

## 4. AI pipeline

```
prompt ──► /api/ai/generate ──► NVIDIA NIM (streamed) ──► JSON extract/repair ──► normalizeGraph ──► validate
                │                                                                                       │
                └─ Clerk auth + MongoDB rate limit                                         graph (no coordinates)
                                                                                                        ▼
                                                              browser: layoutGraph (ELK) ──► elements ──► board
```

* The model returns **semantics only** (nodes, groups, edges, icons), never coordinates. Layout is computed.
* **Why diagrams no longer overlap.** The old pipeline bucketed nodes by substring matches (`"ai"`, `"app"`,
  `"user"` matched almost everything), placed rows by hand while ignoring the edges, and drew frames around
  nodes scattered across zones. Now `layout.ts` runs ELK's layered algorithm over the real hierarchy: groups are
  compound nodes, nodes are sized from measured text, edges are routed orthogonally, and direction is chosen
  by aspect ratio. Tests assert zero node/frame overlaps and no connector crossing a foreign node on
  random 12/30/60-node graphs with nested groups.
* **Robustness.** Reasoning blocks and code fences are stripped, truncated JSON is repaired, ids are
  de-duplicated, dangling edges create the missing node instead of vanishing, group cycles are broken, orphans
  are linked, sizes are capped. A failed reply is fed back once, then the next model in the chain is used.
* **Cost control.** Sign-in required, 6 requests/min and `AI_RATE_LIMIT_PER_HOUR`/hour per user (stored in MongoDB
  so it holds across serverless instances), 2,000-character prompts, bounded `max_tokens`.
* **Revising.** Elements carry a `diagramId`. "Edit this diagram" sends the current diagram as DSL, gets a new
  graph back, and swaps the old elements for the new layout in one undo step.

## 5. Split view

`BoardShell` lays the document and the canvas side by side. The divider (`SplitDivider`, `useSplitPane`) moves the
document pane's width straight in the DOM while dragging (no React render per pointer move), clamps to 20-80%,
commits to `localStorage` (`slate_split_ratio`) on release, and only raises its pointer-capturing overlay after
3 px of travel so a double-click (reset to 50%) still reaches the handle. The canvas host is observed with a
`ResizeObserver`; in split view the engine keeps the world point at the middle of the pane fixed
(`Engine.resizeAnchor = "center"`, `cameraAfterResize`), so resizing never makes the drawing jump.

The two panes reach each other through `DocBridge` (`components/editor/doc-bridge.ts`): the editor registers itself,
the canvas side asks for the word count, the Markdown, or to insert a snapshot / generated documentation. Work
requested while the editor isn't mounted yet (canvas-only view) is queued and run after the editor's own effects.
Snapshots are uploaded PNGs when the board can upload, otherwise inline SVG (the document is one field of the board with a
size cap).

## 6. Billing

```
checkout.js ──► /api/billing/razorpay/create-subscription   price is decided on the server, order / subscription
     │                                                      notes carry { clerkId, tier, interval, seats }
     ▼
 browser handler ──► /api/billing/razorpay/verify-payment   HMAC(order_id|payment_id) with the key secret, then
                                                            fetch the order / subscription from Razorpay, check the
                                                            owner, the plan and the amount, then ─┐
Razorpay ──► /api/billing/razorpay/webhook                  HMAC(raw body) with the webhook secret ─┤
                                                                                                    ▼
                                          billing.syncSubscription  (server-only, not in the RPC registry)
```

* `lib/billing/plans.ts` is the catalogue (INR, paise). `lib/billing/limits.ts` holds the gatekeepers as pure
  functions: `effectiveTier` (pending / halted never grant access; a cancelled plan lasts until its paid period ends;
  a missed renewal lapses after 3 days), `checkBoardLimit`, `checkAiCredit` (30-day rolling refill).
* The board cap is enforced **inside** `slates.create` (the workspace owner's plan applies, so teammates can fill a
  Team workspace). AI credits are reserved atomically before a model call (one conditional update on the user document, so parallel
  requests can't overspend) and refunded if the model produced nothing, so users only pay for diagrams they received.
* Webhook deliveries are idempotent (`billingEvents`, unique delivery id; a failed delivery releases its id so Razorpay's
  retry is applied), and the plan-changing functions are not part of the RPC registry at all, so a signed-in user can't
  grant themselves a plan from the browser.

## 7. Power features

* **FinOps** (`lib/finops`): `pricing-rules.ts` is a documented table of benchmark monthly prices; `estimate.ts`
  prices every recognised node (exact icon match, then keywords), multiplies by declared copies ("x3", "Multi-AZ"),
  and derives tips (NAT gateway -> VPC endpoint, consolidate load balancers, ...). Free plans see the total; paid
  plans get the itemised list and CSV.
* **Traffic simulator** (`TrafficSimulator`): an overlay canvas driven by the engine's camera. Packets follow each
  bound connector in arrow direction (dashed links are amber); `lib/simulation/topology.ts` builds the dependency graph
  and flags components with >= 2 callers (or any stateful dependency) and no replicas, using Tarjan articulation points
  for chain bottlenecks. Managed services (S3, Lambda, DynamoDB...) are treated as redundant.
* **Import code** (`lib/import`, `/api/ai/code-to-diagram`): docker-compose, SQL DDL and folder trees are parsed exactly
  and produce both a graph and Markdown documentation; secrets from `environment` are never copied into the docs.
  Everything else is drawn by the model (1 AI credit) and documented from the resulting graph.
* **Interview mode** (`lib/interview`, `InterviewMode`): the timer is derived from the clock (survives reloads), state
  is saved per board in `localStorage`, the review is either the instant structural check or the AI reviewer
  (`/api/ai/review-architecture`, 1 credit).

## 8. Deployment checklist

1. Set env vars (`.env.example`), including `MONGODB_URI`, `NVIDIA_API_KEY` and the Razorpay variables. In Atlas, allow your
   host's IPs under Network Access. Collections and indexes are created on first connection; there is nothing to deploy.
2. (Coming from Convex only) `npm run db:migrate -- <export folder>`, then `npm run clerk:sync`.
3. Clerk: webhook → `https://<your-domain>/api/webhooks/clerk` for `user.created`, `user.updated`, `user.deleted`; put its
   signing secret in `CLERK_WEBHOOK_SECRET`. (No JWT template is needed any more.)
4. Razorpay: webhook → `https://<your-domain>/api/billing/razorpay/webhook` with `subscription.activated`,
   `subscription.charged`, `subscription.cancelled` (optionally `subscription.halted`, `subscription.completed`).
   Create the four plans if you want recurring billing and put their ids in `RAZORPAY_PLAN_*`.
5. `npm run build && npm start` (or Vercel). `/api/ai/*` can stream or wait on a model, so give them `maxDuration` ≥ 60 s
   on your platform.
6. The realtime server, as its own always-on service (a VPS, Render, Railway, Fly… anything that keeps a Node process and
   WebSockets open, behind TLS): `npm run realtime`, with `MONGODB_URI`, `CLERK_SECRET_KEY`, `REALTIME_ALLOWED_ORIGINS=https://<your-domain>`
   (and `REALTIME_TRUST_PROXY=1` behind a proxy). It listens on `REALTIME_PORT` or `PORT` and answers `GET /health`. Then build the app
   with `NEXT_PUBLIC_REALTIME_URL=wss://<realtime-host>` (it is read at build time). Atlas change streams need a replica
   set (every Atlas cluster is one). Without this step the app still works, on HTTP polling.
