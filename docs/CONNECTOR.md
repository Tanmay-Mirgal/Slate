# Slate ecosystem connector (CP1)

Slate can be driven by a central **Hub** and can tell the Hub what happens on a board. This is the **Ecosystem Connector Protocol v1 (CP1)**: OAuth 2.0 (code + PKCE) for consent, a JSON API under `/api/connect/v1`, and signed webhooks. In the ecosystem Slate is the *Design* stage: a meeting becomes an architecture, the team reviews and approves it, and `board.approved` tells the Hub it is ready to build.

* **Tenant** = a Slate workspace. A connection is pinned to exactly one.
* **Acting user** = the person who clicked Allow. Every request runs as them and is capped by their *current* role (Admin / Editor / Viewer). A connection can never do more than they can in the app, and never touches another workspace.
* With `CONNECTOR_ENABLED` off (the default) every connector route is a `404` and Slate behaves exactly as it did before.

```
Hub                                   Slate                                  User
 | -- GET /.well-known/ecosystem-connector.json -->|
 | <------------ manifest (actions, resources, events, schemas) |
 | -- redirect: /connect/authorize?client_id&redirect_uri&scope&state&code_challenge --> |  signs in, picks a workspace, Allow
 | <-- redirect_uri?code=...&state=... ------------------------------------------------- |
 | -- POST /api/connect/v1/oauth/token (code + code_verifier) -->|
 | <-- access_token (1 h) + refresh_token (90 d, rotating) + tenant + user |
 | -- POST /api/connect/v1/actions/boards.generateDiagram -->|  202 { operation }
 | -- GET  /api/connect/v1/operations/{id} (poll) -->|        succeeded { output }
 | <-- POST <your webhook>  X-CP-Signature: v1=...  (board.generation.completed, board.approved, ...) |
```

## 1. Switching it on

Add to `.env.local` (full list and comments in `.env.example`):

| Variable | Meaning |
|---|---|
| `CONNECTOR_ENABLED=true` | Turns the connector on. Anything else = off. |
| `CONNECTOR_HUB_NAME` | Name shown on the consent screen and in *Connected apps*. |
| `CONNECTOR_HUB_CLIENT_ID`, `CONNECTOR_HUB_CLIENT_SECRET` | The Hub is one pre-registered confidential client. Secret: 32+ characters. |
| `CONNECTOR_HUB_REDIRECT_URIS` | Comma separated, matched **exactly**. `https` only (`http://localhost:PORT/...` is accepted outside production). |
| `CONNECTOR_TOKEN_PEPPER` | 32+ bytes mixed into the HMAC that protects stored tokens. `openssl rand -base64 48` |
| `CONNECTOR_ENCRYPTION_KEY` | 64 hex chars, AES-256-GCM key for webhook signing secrets. `openssl rand -hex 32`. To rotate, put the new key here and the old one in `CONNECTOR_ENCRYPTION_KEY_PREVIOUS`. |
| `CONNECTOR_DISPATCHER` | `inline` (default): `npm run realtime` also delivers webhooks. `external`: run `npm run connector:dispatcher` yourself. |
| `CONNECTOR_BASE_URL` | Public origin advertised in the manifest (defaults to `NEXT_PUBLIC_SITE_URL`). |
| `CONNECTOR_ALLOW_PRIVATE_WEBHOOKS=true` | **Development only.** Lets webhook URLs point at localhost. Ignored when `NODE_ENV=production`. |

If the connector is enabled and a value is missing or weak, **the server refuses to start** and the message lists every problem (`instrumentation.ts`; the realtime server and dispatcher check too).

Webhooks and background AI operations are sent by the dispatcher. Without one running, events are still recorded (`GET /events` works) but nothing is delivered, and an asynchronous operation whose request died is only failed the next time somebody polls it.

## 2. Connecting (OAuth 2.0 code + PKCE)

1. Generate a `code_verifier` (43-128 chars of `A-Za-z0-9-._~`) and `code_challenge = BASE64URL(SHA256(verifier))`. **PKCE with `S256` is mandatory**, and so is `state`.
2. Send the user's browser to
   `https://<slate>/connect/authorize?response_type=code&client_id=...&redirect_uri=...&scope=slate:boards:read slate:boards:write&state=...&code_challenge=...&code_challenge_method=S256`
   * Unknown client or a `redirect_uri` that is not an exact match: an error page, never a redirect.
   * Any other mistake: redirected back with `error` and `state` (RFC 6749).
   * The user signs in with their normal Slate login, picks a workspace (only workspaces where their role allows the requested scopes are offered), and clicks **Allow** or **Cancel** (`error=access_denied`).
3. Exchange the code (single use, 60 s). The Hub authenticates with HTTP Basic or in the body:

```bash
curl -s -X POST https://<slate>/api/connect/v1/oauth/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=authorization_code -d code="$CODE" \
  -d redirect_uri="$REDIRECT_URI" -d code_verifier="$VERIFIER"
```

```json
{ "token_type": "Bearer", "access_token": "cp1_slate_...", "expires_in": 3600,
  "refresh_token": "cp1r_slate_...", "scope": "slate:boards:read slate:boards:write",
  "tenant": { "id": "...", "name": "Acme workspace", "kind": "workspace" },
  "user": { "id": "user_...", "email": "a@b.com", "name": "A B" } }
```

4. Refresh before the hour is up. Refresh tokens **rotate**: each refresh returns a new pair and kills the old one.

```bash
curl -s -X POST https://<slate>/api/connect/v1/oauth/token -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=refresh_token -d refresh_token="$REFRESH"
```

   Presenting an already-rotated refresh token (a stolen copy, or two workers refreshing at once) **revokes the whole grant** and returns `invalid_grant`. Serialise refreshes per grant. Presenting an authorization code twice revokes the tokens issued from it.

5. Revoke (RFC 7009; always `200` for a valid client). The user can also revoke under *Workspace settings > Connected apps*. Revoking removes the webhooks the grant registered.

```bash
curl -s -X POST https://<slate>/api/connect/v1/oauth/revoke -u "$CLIENT_ID:$CLIENT_SECRET" -d token="$ACCESS_OR_REFRESH"
```

OAuth endpoints answer with RFC 6749 errors (`{"error":"invalid_grant","error_description":"..."}`); everything else with the CP1 error object below.

### Scopes

| Scope | Allows |
|---|---|
| `slate:workspaces:read` | the connected workspace and your role |
| `slate:boards:read` | read boards, document, DSL, graph; export; cost estimate; resilience; structural review |
| `slate:boards:write` | create/change boards, documents, status, sharing; archive (Admin/Editor only) |
| `slate:ai:generate` | spend the user's AI credits (diagram generation, AI review) |
| `slate:comments:read` | read comments (and receive `comment.created`) |
| `slate:events:read` | `GET /events` (added automatically with webhooks) |
| `slate:webhooks:manage` | register and manage webhook endpoints |

The *effective* scopes of every request are the granted ones narrowed by the user's role **right now**: demote someone to Viewer and their connection loses write access on the very next call (`403 forbidden`). Remove them from the workspace and every call is `403`.

## 3. Conventions

* JSON in and out. Ids are strings, timestamps ISO-8601 UTC. Every board carries `id`, `webUrl` (a deep link), `createdAt`, `updatedAt`, `metadata`, `externalRef`.
* `X-Request-Id`: send one or get one back; it is in every error and in the audit log.
* **Errors** always look like `{"error":{"code","message","details?","retryable","requestId", ...}}`:

| code | status | notes |
|---|---|---|
| `unauthorized` | 401 | missing/expired/revoked token |
| `insufficient_scope` | 403 | adds `requiredScope` |
| `forbidden` | 403 | scope granted, but the user's role no longer allows it |
| `not_found` | 404 | also for ids in another workspace (ids cannot be probed) |
| `validation_failed` | 400 / 422 / 413 | `details: [{path, message}]` |
| `conflict` | 409 | e.g. a duplicate request still in flight (`Retry-After: 1`) |
| `idempotency_conflict` | 422 | same `Idempotency-Key`, different body |
| `plan_limit` | 402 | adds `limit`, `tier`, `reason` (`board_limit` / `credits_exhausted`), `resetsAt` |
| `precondition_failed` | 412 | e.g. exporting an empty board |
| `rate_limited` | 429 | `Retry-After` |
| `upstream_failed` / `unavailable` / `internal` | 502 / 503 / 500 | `retryable: true` |

* **Pagination**: `?limit=` (default 50, max 200) and `?cursor=`; response `{ "items": [], "nextCursor": "..." | null }`. Cursors are opaque and stable while boards are added.
* **Idempotency**: send `Idempotency-Key` (<= 128 chars) on `POST /actions/{name}`. Same key + same body replays the stored response with `Idempotent-Replay: true`; same key + different body is `422`; a concurrent duplicate is `409`. Kept 24 h per grant.
* **Rate limit**: 120 requests/minute per grant, shared across instances. Headers `X-RateLimit-Limit/Remaining/Reset`; `429` + `Retry-After`.
* **Strict input**: unknown fields are rejected unless you send `Prefer: unknown-fields=ignore`. Bodies are limited to 1 MB (`413`).
* No CORS headers: this API is for servers.

Discovery: `GET /.well-known/ecosystem-connector.json` (same as `/api/connect/v1/manifest`, cacheable 5 min) lists every action with its JSON Schema (2020-12), every resource and event. `GET /api/connect/v1/openapi.json` is the same registry as OpenAPI 3.1. Both are generated from the zod schemas that validate requests, so they cannot drift.

`GET /api/connect/v1/health` (no auth) and `GET /api/connect/v1/me` (plan, usage, `capabilities`) round out the standard endpoints.

## 4. Actions

`POST /api/connect/v1/actions/{name}` with body `{"input": {...}}`. Sync actions answer `200 {"output": ...}`, asynchronous ones `202 {"operation": {"id","status":"pending","pollUrl"}}`. All of them accept `externalRef: {hubProjectId?, hubRunId?, hubStepId?}` (<= 64 chars each) and `metadata` (<= 2 KB) where they create a board; both are stored on the board and **echoed in every event about it**. Shell variables: `A="Authorization: Bearer $TOKEN"`, `B=https://<slate>/api/connect/v1/actions`.

```bash
# boards.create  (slate:boards:write)  - optionally from a template id (GET /templates)
curl -s -X POST $B/boards.create -H "$A" -H 'Content-Type: application/json' -H 'Idempotency-Key: run42-step1' \
  -d '{"input":{"title":"Order platform","template":"aws-microservices","externalRef":{"hubRunId":"run_42"},"metadata":{"ticket":"ENG-7"}}}'

# boards.generateDiagram  (slate:ai:generate + slate:boards:write)  ASYNC, 1 AI credit from the connected user
curl -s -X POST $B/boards.generateDiagram -H "$A" -H 'Content-Type: application/json' \
  -d '{"input":{"title":"Checkout","prompt":"Checkout service with payments, an order queue and Postgres","kind":"architecture","complexity":"standard","mode":"replace","document":{"markdown":"# Meeting summary\n...","mode":"replace"},"externalRef":{"hubRunId":"run_42"}}}'
curl -s https://<slate>/api/connect/v1/operations/op_... -H "$A"   # pending | running | succeeded | failed

# boards.importDsl  (write)  - diagram-as-code; syntax errors come back with line numbers (details[].path = "dsl:<line>")
curl -s -X POST $B/boards.importDsl -H "$A" -H 'Content-Type: application/json' \
  -d '{"input":{"boardId":"...","dsl":"title Shop\ntype architecture\nWeb\nAPI\nWeb > API : HTTPS\n","mode":"append"}}'

# boards.importCode  (write)  - docker-compose / SQL / folder tree, no AI; writes the generated docs to the document pane
curl -s -X POST $B/boards.importCode -H "$A" -H 'Content-Type: application/json' \
  -d '{"input":{"title":"Stack","content":"services:\n  web:\n    image: nginx\n","format":"auto","document":"append"}}'

# boards.setDocument  (write)  - Markdown -> the editor's document (and its Markdown text)
curl -s -X POST $B/boards.setDocument -H "$A" -H 'Content-Type: application/json' \
  -d '{"input":{"boardId":"...","markdown":"# Decisions\n- Use Postgres","mode":"append"}}'

# boards.setStatus  (write; Admin/Editor)  draft | in_review | approved  -> board.status_changed (+ board.approved)
curl -s -X POST $B/boards.setStatus -H "$A" -H 'Content-Type: application/json' \
  -d '{"input":{"boardId":"...","status":"approved","note":"LGTM"}}'

# boards.setSharing  (write)  none | view | edit -> { publicUrl }
curl -s -X POST $B/boards.setSharing -H "$A" -H 'Content-Type: application/json' -d '{"input":{"boardId":"...","linkAccess":"view"}}'

# boards.review  (boards:read; mode "ai" also needs slate:ai:generate and costs 1 credit)
curl -s -X POST $B/boards.review -H "$A" -H 'Content-Type: application/json' -d '{"input":{"boardId":"...","mode":"structural"}}'

# boards.estimateCost / boards.analyzeResilience  (boards:read)  - cost is always itemised, on every plan
curl -s -X POST $B/boards.estimateCost -H "$A" -H 'Content-Type: application/json' -d '{"input":{"boardId":"..."}}'
curl -s -X POST $B/boards.analyzeResilience -H "$A" -H 'Content-Type: application/json' -d '{"input":{"boardId":"..."}}'

# boards.export  (boards:read)  dsl | json | svg | markdown, inline, <= 1 MB
curl -s -X POST $B/boards.export -H "$A" -H 'Content-Type: application/json' -d '{"input":{"boardId":"...","format":"markdown"}}'

# boards.archive  (write)  soft archive; the connector cannot hard-delete
curl -s -X POST $B/boards.archive -H "$A" -H 'Content-Type: application/json' -d '{"input":{"boardId":"..."}}'
```

Notes: `mode: "replace"` removes what is on the board **after saving a version** (Version history can restore it); `append` places the new diagram to the right of the existing content. Layout runs on the server, so generated diagrams never overlap. Boards created by the connector show a *Created via <Hub>* tag; the review status shows as a pill in the editor and on dashboard cards. The document pane does not live-reload in an editor that is already open: whoever saves last wins.

An asynchronous operation reserves its credit **when accepted** (so `402 plan_limit` is immediate), returns it exactly once if the run fails, and a stalled one is failed (credit returned) by the next poll or the dispatcher.

## 5. Resources (GET, `Authorization: Bearer`)

| Path | Scope | Returns |
|---|---|---|
| `/workspaces` | `slate:workspaces:read` | the pinned workspace and your role |
| `/boards?query=&status=&updatedSince=` | `slate:boards:read` | boards, most recently edited first |
| `/boards/{id}` | `slate:boards:read` | one board (stats, status, sharing, metadata, externalRef) |
| `/boards/{id}/document` | `slate:boards:read` | `{markdown, text, bytes, updatedAt}` |
| `/boards/{id}/dsl` | `slate:boards:read` | the diagram as diagram-as-code |
| `/boards/{id}/graph` | `slate:boards:read` | nodes, groups, edges (no coordinates) |
| `/boards/{id}/comments` | `slate:comments:read` | threads with messages |
| `/templates` | `slate:boards:read` | built-in templates (`id`, `title`, `kind`) |

## 6. Webhooks and events

Register an endpoint (the secret is shown **once**; it is stored encrypted):

```bash
curl -s -X POST https://<slate>/api/connect/v1/webhooks -H "$A" -H 'Content-Type: application/json' \
  -d '{"url":"https://hub.example.com/hooks/slate","events":["board.*"],"description":"prod"}'
# -> 201 { "id": "...", "url": "...", "events": ["board.*"], "secret": "whsec_...", "status": "active" }
```

Also: `GET /webhooks`, `GET|PATCH|DELETE /webhooks/{id}` (`PATCH {"status":"active"}` re-enables a disabled endpoint), `GET /webhooks/{id}/deliveries`, `POST /webhooks/{id}/deliveries/{deliveryId}/redeliver`. At most 5 endpoints per connection. Subscriptions are exact types or `prefix.*`; they are filtered **before** anything is queued, and an endpoint only receives events its grant could read through the API (`comment.created` needs `slate:comments:read`; a user who left the workspace receives nothing).

**SSRF protection.** URLs must be `https` in production. The host is resolved and every address must be public: loopback, private (RFC 1918 / ULA), link-local, cloud-metadata, CGNAT and reserved ranges are refused, in every IPv4/IPv6 notation. The check runs at registration **and again before every delivery**, the request goes to the address that was checked, redirects are never followed, and the timeouts are 5 s to connect and 10 s overall.

**Delivery.** `POST` with the envelope as the body:

```json
{ "id": "evt_01J...", "type": "board.approved", "apiVersion": "cp1", "service": "slate",
  "occurredAt": "2026-01-01T10:00:00.000Z", "tenantId": "<workspaceId>",
  "actor": { "id": "user_...", "name": "A B", "kind": "user|system|connector" },
  "externalRef": { "hubProjectId": "...", "hubRunId": "...", "hubStepId": "..." },
  "data": { } }
```

Headers: `X-CP-Event`, `X-CP-Delivery` (stable across retries), `X-CP-Timestamp` (unix seconds), `X-CP-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`, `User-Agent: Slate-Connector/1.0`. Verify like this (reject timestamps older than 5 minutes, compare in constant time, de-duplicate on `id`):

```js
const crypto = require("crypto");
function verify(secret, rawBody, headers) {
  const ts = headers["x-cp-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "v1=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(headers["x-cp-signature"] || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Delivery is **at-least-once** and unordered (use `occurredAt`). Any `2xx` within 10 s succeeds. Otherwise it is retried after 10 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h (+/-20% jitter): the first try plus 8 retries over about 11 hours, then it is marked failed (visible in the delivery log). `410 Gone` disables the endpoint immediately; 50 failed attempts in a row, or 3 days of nothing but failures, disable it too (reason in `GET /webhooks/{id}` and in *Connected apps*).

**Missed webhooks.** `GET /events?cursor=&types=` (`slate:events:read`) returns the workspace's event log in order, kept 7 days: the same envelopes the webhooks carried. Keep the last `nextCursor` you processed and ask for everything after it.

**Outbox.** The event row is written in the **same MongoDB transaction** as the change that caused it (board create / archive / share / status, comments), then sent by the dispatcher. A crash between the two cannot lose the event and a rolled-back change cannot emit one. This needs a replica set, which Atlas always is; on a standalone `mongod` (unit tests, a bare local database) the event is inserted right after the change instead, and a crash in that instant could lose it.

### Event catalog

| Type | When | `data` |
|---|---|---|
| `board.created` | a board is created (app or connector) | `{board}` |
| `board.archived` | a board is archived | `{board}` |
| `board.updated` | content changed. **Coalesced**: at most one per board per minute | `{board, stats}` |
| `board.generation.started` / `.completed` / `.failed` | AI generation lifecycle | `{board, operationId, diagram?, error?}` |
| `board.status_changed` | draft / in_review / approved changed | `{board, from, to, note?, by}` |
| `board.approved` | moved to approved | `{board, note?, by, stats, dslBytes}` |
| `board.shared` | link sharing changed | `{board, linkAccess}` |
| `comment.created` | a thread or reply was added | `{board, comment: {id, authorName, body, createdAt}}` |

`board` is the same object `GET /boards/{id}` returns. Example `board.approved`:

```json
{ "id": "evt_01JABC...", "type": "board.approved", "apiVersion": "cp1", "service": "slate",
  "occurredAt": "2026-01-01T10:00:00.000Z", "tenantId": "665f...",
  "actor": { "id": "user_2x", "name": "Edie Editor", "kind": "connector" },
  "externalRef": { "hubProjectId": "prj_1", "hubRunId": "run_42" },
  "data": { "board": { "id": "665a...", "title": "Order platform", "status": "approved", "webUrl": "https://<slate>/canvas/665a...",
                       "stats": { "nodes": 12, "connectors": 11 }, "createdVia": "connector" },
            "note": "LGTM", "by": { "id": "user_2x", "name": "Edie Editor" },
            "stats": { "nodes": 12, "connectors": 11 }, "dslBytes": 1984 } }
```

Events never carry tokens, secrets or personal data beyond what the matching resource returns.

## 7. Security notes

* Tokens are opaque (`cp1_slate_` / `cp1r_slate_` + 32 random bytes). Only `HMAC-SHA256(CONNECTOR_TOKEN_PEPPER, token)` is stored, compared in constant time, and never logged. Webhook secrets are AES-256-GCM encrypted at rest with a versioned key. No third-party credentials (Clerk, Razorpay, ...) are ever returned.
* Tenant isolation is enforced in the data-access layer (`lib/connector/data.ts`): every board query includes the grant's workspace, so another workspace's ids are `404`.
* A connector token cannot mint other tokens or grants.
* Every call is written to the audit log (`via: "connector"`, client id, grant id, action, status, request id; never payloads), kept 90 days; the last 20 show under *Connected apps*.
* The consent form is a server action with a signed, user-bound, 10-minute request blob; the redirect is only to the registered URI.
* Anti-clickjacking headers (`X-Frame-Options: SAMEORIGIN`) are unchanged on every route.

## 8. Runbook

| Symptom | Check |
|---|---|
| Server will not start | The message lists every missing/weak `CONNECTOR_*` value. |
| All connector routes 404 | `CONNECTOR_ENABLED` must be exactly `true` on the Next.js app. |
| `invalid_client` | client id/secret mismatch (HTTP Basic values are URL-decoded first). |
| Hub gets `invalid_grant` on refresh | A refresh token was used twice (two workers?) so the grant was revoked: the user must connect again. Serialise refreshes. |
| Webhooks never arrive | Is the dispatcher running (`CONNECTOR_DISPATCHER=inline` + `npm run realtime`, or `npm run connector:dispatcher`)? Look at `GET /webhooks/{id}` (disabled? why) and `/deliveries`. |
| Endpoint `disabled` | Fix the receiver, then `PATCH /webhooks/{id}` with `{"status":"active"}`; missed events are in `GET /events`. |
| `plan_limit` | `reason: board_limit` = the workspace owner's plan is full (free = 3 boards); `credits_exhausted` = the connected *user's* monthly AI credits (`resetsAt`). |
| Operation stuck | Poll it: a lease that expired is failed and its credit returned. Make sure a dispatcher runs. |
| Rotate the encryption key | New key in `CONNECTOR_ENCRYPTION_KEY`, old in `CONNECTOR_ENCRYPTION_KEY_PREVIOUS`. |

`npm run connector:smoke -- --user <clerkId> --workspace <id>` exercises a running instance end to end (see `scripts/connector-smoke.ts`).

## 9. Not in v1

Embed sessions (`/embed/*`), connector API keys (`cp1k_`), `comments.add`, PNG export. A manual edit of a board made in an editor that is open is not announced instantly (`board.updated` is coalesced to one a minute).
