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
liveSessions cursors/selection/drafts                                          TTL index: MongoDB removes rows ~90 s after their last write
rateLimits   fixed-window counters per user and bucket                         TTL index
files        uploaded images (GridFS)
```

* **Batched writes.** `elements.apply` takes the ops of one gesture (≤ 500). Duplicate ops on an element are
  collapsed, unchanged rows are not rewritten (`rev` only bumps on real changes), and `slates.lastEdited` is
  touched at most every 30 s, so busy boards don't contend on the slate document.
* **A change feed, not a subscription.** Every write to a board takes the next number from the board's counter
  (`slates.elementSeq`, one atomic `$inc` per batch). Clients call `elements.sync({ slateId, since })` and get only the rows
  with a higher number, plus the ids deleted since. The first call (`since: 0`) returns the whole board. Rows are parsed
  once per `(eid, rev)`.
  * *Late writers.* Numbers are handed out before rows become visible, so a reader could see 11 before 10. Every poll
    therefore also re-reads rows written in the last 5 s (the client ignores rows whose `rev` it already has).
  * *Deleted elements* stay as markers for 6 h so clients that poll in that window learn about the delete. A client that
    was away longer is told to reload the whole board (`slates.tombstoneFloor`).
  * *Cadence.* About 0.9 s while other people are on the board, 2.5 s when you are alone, paused while the tab is hidden,
    and immediately after your own edit is saved.
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
* Every viewer polls its board, so cost grows with *viewers × poll rate*. That is the real scaling unit: **many boards
  scale horizontally** (MongoDB + stateless Next.js), but a *single* board with hundreds of simultaneous editors
  needs a push-based realtime layer (see the seam below).

## 3. Live cursors

`useBoardPresence` joins the board once (access is verified there) and thereafter calls `presence.update` with an
unguessable row id, so the hot path is a single document update with no extra reads. Peers are read by polling
`presence.list` about once a second.

* Updates are **coalesced**: at most one in flight per tab; while waiting only the newest state is kept.
* The send interval **backs off** with room size (`66 ms + 25 ms × peers`, capped at 400 ms).
* Remote cursors are **interpolated per frame** in the DOM (`CursorsOverlay`), so low update rates still look
  smooth, and they are positioned in screen space (crisp at any zoom).
* Freshness uses the *client's* clock: a session whose `lastSeen` stops changing for 45 s disappears, so server
  clock skew can't make cursors stick. MongoDB's TTL index deletes rows ~90 s after their last write.
* Teammates' **selection outlines**, **in-progress shapes** and **drag previews** ride on the same channel.

`PresenceChannel` (`lib/canvas/engine.ts`) is the seam for swapping in a dedicated transport (Liveblocks,
PartyKit, Ably, a WebSocket service) if a single room ever needs 60 Hz cursors for large audiences.

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
