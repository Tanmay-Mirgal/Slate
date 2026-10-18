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

## 5. Deployment checklist

1. `npx convex deploy` (adds tables, indexes, crons).
2. Set env vars (`.env.example`), including `NVIDIA_API_KEY`.
3. Clerk: JWT template `convex`, webhook → `https://<deployment>.convex.site/clerk`.
4. `npm run build && npm start` (or Vercel). `/api/ai/generate` streams, so give it `maxDuration` ≥ 60 s on
   your platform.
