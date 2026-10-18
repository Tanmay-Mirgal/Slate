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

## 2. Persistence and sync (`convex/`)

```
slates      metadata: title, workspace, linkAccess, schemaVersion
elements    one row per element: (slateId, eid, shard, z, rev, data)    indexes: by_slate_shard, by_slate_eid
liveSessions cursors/selection/drafts, swept by a cron after 90 s
rateLimits  fixed-window counters per user and bucket
```

* **Batched writes.** `elements.apply` takes the ops of one gesture (≤ 500). Duplicate ops on an element are
  collapsed, unchanged rows are not rewritten (`rev` only bumps on real changes), and `slates.lastEdited` is
  touched at most every 30 s, so busy boards don't contend on the slate document.
* **Sharded reads.** A client subscribes to 4 queries (`elements.list` per shard). Convex re-sends a query's
  full result when anything in it changes, so sharding cuts per-edit traffic to ~¼. Rows are parsed once per
  `(eid, rev)`.
* **No snap-back.** While an element is being dragged, queued, or in flight, incoming server rows for it are
  ignored. After the write is acknowledged there's a short grace period before server state wins again.
* **Access** (`access.ts`): Admin/Editor → edit, Viewer → view, legacy owner → edit, and link sharing
  (`view` for anyone, `edit` for signed-in users). Queries return empty rather than throwing when access is
  revoked mid-session. Every mutation re-checks.
* **Uploads** go to Convex storage (not inline data URIs) via `files.generateUploadUrl` → `finalizeImage`, which
  validates type and size. Rejections are *returned*, not thrown, because a throwing mutation rolls back its own
  `storage.delete`.

### Limits worth knowing

* One mutation ≤ 500 element ops; one element ≤ 250 KB. There's no hard cap on elements per board; boards with
  tens of thousands of elements will hit Convex's per-query read limits.
* Every board change fans out to every viewer of that board. That is the real scaling unit: **millions of users
  across many boards scale horizontally** (Convex + stateless Next.js), but a *single* board with hundreds of
  simultaneous editors would need a dedicated realtime layer.

## 3. Live cursors

`useBoardPresence` joins the board once (access is verified there) and thereafter calls `presence.update` with an
unguessable row id, so the hot path is a single document patch with no extra reads.

* Updates are **coalesced**: at most one in flight per tab; while waiting only the newest state is kept.
* The send interval **backs off** with room size (`66 ms + 25 ms × peers`, capped at 400 ms).
* Remote cursors are **interpolated per frame** in the DOM (`CursorsOverlay`), so low update rates still look
  smooth, and they are positioned in screen space (crisp at any zoom).
* Freshness uses the *client's* clock: a session whose `lastSeen` stops changing for 45 s disappears, so server
  clock skew can't make cursors stick. A cron deletes rows older than 90 s.
* Teammates' **selection outlines**, **in-progress shapes** and **drag previews** ride on the same channel.

`PresenceChannel` (`lib/canvas/engine.ts`) is the seam for swapping in a dedicated transport (Liveblocks,
PartyKit, Ably, a WebSocket service) if a single room ever needs 60 Hz cursors for large audiences.

## 4. AI pipeline

```
prompt ──► /api/ai/generate ──► NVIDIA NIM (streamed) ──► JSON extract/repair ──► normalizeGraph ──► validate
                │                                                                                       │
                └─ Clerk auth + Convex rate limit                                          graph (no coordinates)
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
* **Cost control.** Sign-in required, 6 requests/min and `AI_RATE_LIMIT_PER_HOUR`/hour per user (stored in Convex
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
Snapshots are uploaded PNGs when the board can upload, otherwise inline SVG (the document is one Convex field with a
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
                                                  convex billing.syncSubscription  (needs BILLING_SYNC_SECRET)
```

* `lib/billing/plans.ts` is the catalogue (INR, paise). `lib/billing/limits.ts` holds the gatekeepers as pure
  functions: `effectiveTier` (pending / halted never grant access; a cancelled plan lasts until its paid period ends;
  a missed renewal lapses after 3 days), `checkBoardLimit`, `checkAiCredit` (30-day rolling refill).
* The board cap is enforced **inside** `slates.create` (the workspace owner's plan applies, so teammates can fill a
  Team workspace). AI credits are reserved atomically before a model call (`billing.reserveAiCredit`) and refunded
  with the server secret if the model produced nothing, so users only pay for diagrams they received.
* Webhook deliveries are idempotent (`billingEvents`), and the plan mutations are public Convex functions guarded by
  a constant-time secret check, so a signed-in user can't grant themselves a plan from the browser.

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

1. `npx convex deploy` (adds tables, indexes, crons: `users` billing fields, `billingEvents`, `slateFavorites`,
   `slateStats`).
2. Set env vars (`.env.example`), including `NVIDIA_API_KEY` and the Razorpay variables. Set
   `BILLING_SYNC_SECRET` **both** in the app environment and in the Convex dashboard.
3. Clerk: JWT template `convex`, webhook → `https://<deployment>.convex.site/clerk`.
4. Razorpay: webhook → `https://<your-domain>/api/billing/razorpay/webhook` with `subscription.activated`,
   `subscription.charged`, `subscription.cancelled` (optionally `subscription.halted`, `subscription.completed`).
   Create the four plans if you want recurring billing and put their ids in `RAZORPAY_PLAN_*`.
5. `npm run build && npm start` (or Vercel). `/api/ai/*` can stream or wait on a model, so give them `maxDuration` ≥ 60 s
   on your platform.
