# PROMPT 1 / 3 — Build the Ecosystem Connector (CP1) for **Slate**

> Paste this whole file into Claude Code, opened in the **Slate** repository. Start in plan mode: read the code listed
> below, produce a plan, then implement phase by phase, committing after each phase.

## 0. Your role

You are a senior full-stack engineer adding a **first-class, secure, documented connector API** to Slate so that an
external central platform (the "Hub") can drive Slate programmatically and receive events from it. You are *not*
rebuilding Slate. Existing behavior, UI and performance must remain unchanged when the connector is disabled.

Read `AGENTS.md` first: this is a recent Next.js version with breaking changes. Before writing route handlers, proxy
(middleware) code, rewrites or headers, read the relevant guides in `node_modules/next/dist/docs/`.

## 1. What Slate is (verified from the repo)

Slate is an infinite canvas for software teams: **draw it, generate it with AI, or write it as code**.
Next.js 16 / React 19 / TypeScript, MongoDB (Atlas) via the raw `mongodb` driver, Clerk auth, NVIDIA NIM models for AI,
Razorpay billing, a separate long-running **WebSocket realtime server** (`lib/realtime`, `scripts/realtime.ts`), Tiptap
documents next to the canvas, ELK layout.

Why people use it: system-design / architecture whiteboarding with real product icons (170+ brand logos, AWS/GCP/Azure),
AI diagram generation (architecture, flowchart, ER, mind map, sequence) from a prompt, "diagram as code" DSL that
round-trips, importing docker-compose / SQL / folder trees into a diagram **plus generated documentation**, a live
cloud-cost (FinOps) estimate, single-point-of-failure analysis, interview mode, live collaboration and comments, export
to PNG/SVG/JSON. In the ecosystem Slate is the **"Design" stage**: a meeting's decisions become an architecture that
the team reviews and approves before code is written.

## 2. Existing code you must understand before coding

- `lib/server/*` = the "API". Server functions are declared with `query()` / `mutation()` (`lib/server/fn.ts`) and take a
  `Ctx = { userId: string|null; profile(): Promise<UserDoc|null>; defer(task) }` plus zod-validated args. Access control
  lives in **one resolver**: `lib/server/access.ts` (`resolveAccess`, `requireView`, `requireEdit`, `requireComment`).
  `lib/server/context.ts` builds `Ctx` from the Clerk session. `lib/server/registry.ts` is the whitelist exposed at
  `POST /api/rpc`.
  ➜ **Reuse, don't duplicate.** The connector must call these same functions/helpers with a synthesized `Ctx`
  (`userId` = the grant's Clerk user id, `profile` = `ensureUser`, `defer` = a no-op/`after()` wrapper) so that
  workspace roles (Admin/Editor/Viewer), board limits (`assertBoardCapacity`), link-sharing rules and every existing
  invariant apply automatically. Add the **scope + pinned-workspace** checks on top, never instead.
- Elements: one MongoDB row per element (`elements` collection), written through `elements.apply` with ops
  `{t:"put", id, z, data:string(JSON)} | {t:"del", id}` (≤ 500 ops/batch, ≤ 250 KB/element), with a per-board change
  counter (`slates.elementSeq`) feeding realtime and polling. The realtime server watches change streams, so writes made
  by the connector appear live to people on the board for free — keep using `elements.apply` semantics.
- AI: `app/api/ai/generate/route.ts` (auth → `checkAiRateLimit` → `reserveAiCredit` → `generateGraph()` from
  `lib/ai/generate.ts` → refund on failure). Layout: `layoutGraph(graph)` in `lib/diagram/layout.ts` returns
  `{ elements: El[], bounds, direction, diagramId, members }` ready to insert. **Caveat:** text measurement
  (`lib/canvas/text.ts`) uses `OffscreenCanvas`/`document`, i.e. it is browser-bound. For server-side layout you must
  provide a measurement shim (e.g. `@napi-rs/canvas` or a deterministic font-metrics approximation) behind an interface
  so tests are deterministic; verify with the existing "no overlaps on random 12/30/60-node graphs" tests that layout
  quality does not regress.
- Other reusable domain code: `lib/diagram/dsl.ts` (`parseDsl`, `graphToDsl`), `lib/diagram/extract.ts`
  (`graphFromElements`), `lib/import/*` (docker-compose/SQL/tree → graph + Markdown docs, no AI), `lib/finops/estimate.ts`,
  `lib/simulation/topology.ts` (SPOF analysis), `lib/interview/review.ts` + `app/api/ai/review-architecture/route.ts`,
  `lib/canvas/svg.ts` (SVG export), `lib/server/comments.ts`, `lib/server/versions.ts`, `lib/billing/*`
  (`limitsFor`, `effectiveTier`, `reserveAiCredit`/`refundAiCredit`), the documents (`SlateDoc.documentJson` Tiptap JSON +
  `documentText`), `components/editor/markdown-parser.ts` (Markdown → editor content; check whether it is DOM-free).
- `proxy.ts` is `clerkMiddleware` and matches `/(api|trpc)(.*)`, protecting only `/dashboard`. Connector routes must work
  with **no Clerk session** (they authenticate with their own bearer tokens); make sure Clerk never intercepts or rejects
  them, and that `/.well-known/ecosystem-connector.json` is reachable.
- `next.config.ts` sets `X-Frame-Options: SAMEORIGIN` on `/:path*` and `Cache-Control: no-store` on `/api/*` (except
  files). Keep that.
- Tests: Vitest with `mongodb-memory-server`. Follow the existing style (database logic tested against in-memory Mongo).
- Docs live in `docs/`. Add `docs/CONNECTOR.md`.

## 3. The protocol you must implement

Implement **CP1** exactly as specified below (it is shared with the Orb and Meetup connectors; do not invent
deviations — if something is impossible, stop and report it instead of silently diverging).

## Ecosystem Connector Protocol v1 (CP1)

This protocol is the single contract between the **Hub** (a central control-plane product) and each **Service**
(Slate, Orb, Meetup). Every Service implements exactly this contract, so the Hub can talk to all of them with one
generic client. Implement it faithfully: a separate conformance test-suite will be run against your implementation.

Terms: **Hub** = the central platform. **Service** = the app you are working on. **Tenant** = the Service's unit of
data ownership (Slate: workspace, Orb: organization/team, Meetup: Clerk organization). **Grant** = one user's consent,
for one tenant, with a set of scopes. **Action** = a write/command. **Resource** = a read. **Event** = an outbound
signed webhook. **Operation** = a long-running action tracked by id.

All paths below are relative to the Service's public origin. Everything lives under `/api/connect/v1`, except the
well-known document and the user-facing consent page.

---

### 1. Discovery

`GET /.well-known/ecosystem-connector.json` (public, cacheable 5 min) and the identical
`GET /api/connect/v1/manifest`:

```jsonc
{
  "protocol": "cp1",
  "service": "slate",                       // slate | orb | meetup
  "displayName": "Slate",
  "version": "1.0.0",                       // connector version, semver
  "baseUrl": "https://slate.example.com",
  "auth": {
    "type": "oauth2_code_pkce",
    "authorizeUrl": "https://slate.example.com/connect/authorize",
    "tokenUrl": "https://slate.example.com/api/connect/v1/oauth/token",
    "revokeUrl": "https://slate.example.com/api/connect/v1/oauth/revoke",
    "scopes": [{ "name": "slate:boards:read", "description": "Read boards and their content" }]
  },
  "tenantKind": "workspace",                // workspace | organization
  "actions":   [{ "name": "boards.create", "description": "...", "scopes": ["slate:boards:write"],
                  "async": false, "idempotent": true, "inputSchema": { /* JSON Schema 2020-12 */ },
                  "outputSchema": { /* JSON Schema */ } }],
  "resources": [{ "name": "boards.list", "method": "GET", "path": "/boards", "scopes": ["slate:boards:read"],
                  "description": "...", "querySchema": { }, "outputSchema": { } }],
  "events":    [{ "type": "board.approved", "description": "...", "scopes": ["slate:boards:read"],
                  "dataSchema": { /* JSON Schema of `data` */ } }],
  "limits": { "requestsPerMinute": 120, "maxBodyBytes": 1048576, "webhookMaxEndpoints": 5 },
  "links": { "docs": "https://.../docs/CONNECTOR.md", "openapi": "/api/connect/v1/openapi.json" }
}
```

The manifest MUST be generated from the same registry/zod schemas that validate requests at runtime (single source of
truth: define each action once with a zod schema, derive JSON Schema + OpenAPI from it). The Hub renders its workflow
builder forms directly from `actions[].inputSchema`, so schemas must carry `title`, `description`, `enum`, `default`,
`minLength`/`maxLength`, and `examples`.

### 2. Authentication & consent (OAuth 2.0 Authorization Code + PKCE)

The Hub is a pre-registered confidential client. Configure it via env (see each Service's env list):
`CONNECTOR_HUB_CLIENT_ID`, `CONNECTOR_HUB_CLIENT_SECRET`, `CONNECTOR_HUB_REDIRECT_URIS` (comma separated, **exact
match** only, https required except `http://localhost:*` in development).

#### 2.1 Authorize (user-facing page, uses the Service's existing login)
`GET /connect/authorize?response_type=code&client_id=&redirect_uri=&scope=&state=&code_challenge=&code_challenge_method=S256`

- Validate `client_id`, exact `redirect_uri`, `S256` challenge (PKCE is mandatory), `state` present, scopes ⊆ manifest
  scopes. On invalid client/redirect: render an error page, **never redirect**. On other errors redirect back with
  `error` + `state` per RFC 6749.
- Require the user to be signed in with the Service's normal auth (redirect to its sign-in and back, preserving the
  full query string).
- Show a consent screen in the Service's own design system: "<Hub name> wants to connect to your <Service> account",
  list scopes in plain language, **tenant picker** (only tenants where the user holds a role that can satisfy the
  requested scopes), Allow / Cancel. A grant is pinned to exactly one tenant.
- On Allow: create a single-use authorization code (≥ 32 random bytes, TTL 60 s, bound to client, user, tenant,
  scopes, redirect_uri, code_challenge) and redirect with `code` + `state`.

#### 2.2 Token
`POST /api/connect/v1/oauth/token` (`application/x-www-form-urlencoded` or JSON; client auth via HTTP Basic or body):
- `grant_type=authorization_code` + `code`, `redirect_uri`, `code_verifier`
- `grant_type=refresh_token` + `refresh_token`

Response:
```json
{ "token_type": "Bearer", "access_token": "cp1_slate_…", "expires_in": 3600,
  "refresh_token": "cp1r_slate_…", "scope": "slate:boards:read slate:boards:write",
  "tenant": { "id": "…", "name": "Acme workspace", "kind": "workspace" },
  "user":   { "id": "…", "email": "a@b.com", "name": "A B" } }
```
- Tokens are opaque: prefix + ≥ 32 random bytes (base64url). **Store only `HMAC-SHA256(CONNECTOR_TOKEN_PEPPER, token)`**;
  compare in constant time. Never log tokens.
- Access TTL 1 h. Refresh TTL 90 d, **rotating**: each refresh returns a new refresh token and invalidates the old one.
  Re-use of an already-rotated refresh token ⇒ revoke the whole grant (token-family theft detection) and return
  `invalid_grant`.
- Authorization codes are single use; a second use revokes tokens issued from it.
- Errors follow RFC 6749 (`invalid_request`, `invalid_client`, `invalid_grant`, `invalid_scope`, …).

#### 2.3 Revoke
`POST /api/connect/v1/oauth/revoke` (`token`, optional `token_type_hint`) → always `200` (RFC 7009). The user can also
revoke from the Service UI (see "Connected apps" in each prompt). Revoking deletes/disables webhook endpoints created
by that grant.

#### 2.4 Authorization rules at request time
For every `/api/connect/v1/*` request (except manifest, health, token, revoke):
1. `Authorization: Bearer <token>` → look up by HMAC, reject if expired/revoked ⇒ `401 unauthorized`.
2. Check the required scope for the endpoint ⇒ `403 insufficient_scope` (include `requiredScope`).
3. Resolve the **acting user** from the grant and **re-evaluate that user's current role in the pinned tenant on every
   request**. A connector token can never do more than the user could do in the Service UI, and never touches data
   outside the pinned tenant (cross-tenant ids ⇒ `404 not_found`, never `403`, so ids cannot be probed).
4. A connector token must not be able to mint other tokens/grants/API keys.
5. Update `lastUsedAt` at most once per 5 minutes per grant.

#### 2.5 Fallback: connector API key
For self-hosters who prefer pasting a key: the Service may let a user create a "Connector API key" in its settings UI
(shown once, same hashing, same scope + tenant pinning, `cp1k_<svc>_…`). The verifier in 2.4 accepts both. Optional in v1.

### 3. Request & response conventions

- JSON in/out (`application/json; charset=utf-8`). IDs are strings. Timestamps are ISO-8601 UTC strings.
- Every entity returned includes `id`, `webUrl` (deep link into the Service UI) and, where it applies, `createdAt`,
  `updatedAt`, `metadata` (object ≤ 2 KB, caller-defined) and `externalRef` (see 3.3).
- **Errors** (always this shape, never HTML):
  ```json
  { "error": { "code": "validation_failed", "message": "Human readable", "details": [{ "path": "title", "message": "Required" }],
               "retryable": false, "requestId": "req_…" } }
  ```
  Codes: `unauthorized` 401 · `insufficient_scope` 403 · `forbidden` 403 · `not_found` 404 · `validation_failed` 400/422 ·
  `conflict` 409 · `idempotency_conflict` 422 · `plan_limit` 402 (include `limit`, `resetsAt` when known) ·
  `precondition_failed` 412 (include `fixUrl` when the user can fix it in the Service UI) · `rate_limited` 429
  (+ `Retry-After`) · `upstream_failed` 502 · `unavailable` 503 · `internal` 500. `retryable: true` only for 429/502/503/5xx.
- **Pagination**: `?limit=` (default 50, max 200) & `?cursor=`; response `{ "items": [], "nextCursor": "…"|null }`. Cursors
  are opaque, stable under concurrent inserts.
- **Idempotency**: every `POST` action accepts `Idempotency-Key` (≤ 128 chars). Store `(grantId, key) → {requestHash,
  response, status}` for 24 h (TTL). Same key + same body ⇒ replay the stored response with `Idempotent-Replay: true`;
  same key + different body ⇒ `422 idempotency_conflict`; concurrent duplicate ⇒ `409 conflict` with `Retry-After: 1`.
- **Rate limiting**: per grant, `limits.requestsPerMinute`, headers `X-RateLimit-Limit/Remaining/Reset`; `429` +
  `Retry-After` when exceeded. Must be shared across serverless instances (use the datastore, not process memory).
- **Request IDs**: accept `X-Request-Id` or generate one; echo it in the response and in every log line.
- **Forward compatibility**: ignore unknown request fields only when `Prefer: unknown-fields=ignore`; otherwise reject
  (strict zod). Additive response changes are non-breaking; the Hub ignores unknown response fields.
- Body limit `limits.maxBodyBytes` ⇒ `413`. No CORS headers on `/api/connect/v1/*` (server-to-server only).

#### 3.3 Correlation: `externalRef` and `metadata`
Any action that creates an entity accepts optional `externalRef: { hubProjectId?, hubRunId?, hubStepId? }` (strings
≤ 64) and `metadata`. Persist them on the entity and **echo `externalRef` inside every event about that entity**
(and about child entities, e.g. a deployment inherits its project's). This is how the Hub correlates events with
workflow runs without fragile matching.

### 4. Standard endpoints (every Service)

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /health` | none | `{ "status": "ok", "version": "1.0.0", "time": "…" }` (no secrets, no tenant data) |
| `GET /me` | any valid token | `{ user, tenant, scopes, grantId, plan: { name, limits, usage }, capabilities: {…service specific…} }` |
| `GET /openapi.json` | none | OpenAPI 3.1 generated from the registry |
| `POST /actions/{name}` | per action | Execute an action. Body = `{ "input": {…} }`. Sync ⇒ `200 { "output": {…} }`. Async ⇒ `202 { "operation": { "id", "status": "pending", "pollUrl" } }` |
| `GET /operations/{id}` | same scope as action | `{ id, action, status: pending\|running\|succeeded\|failed\|canceled, output?, error?, createdAt, finishedAt? }`. Operations are retained 7 days, owned by the grant |
| `GET <resource paths>` | per resource | Service-specific reads |
| `POST /webhooks` | `<svc>:webhooks:manage` | Register an endpoint: `{ url, events: ["board.*"], description? }` ⇒ `201 { id, url, events, secret: "whsec_…" }` — the secret is returned **once** |
| `GET /webhooks` · `GET /webhooks/{id}` · `PATCH /webhooks/{id}` · `DELETE /webhooks/{id}` | same | Manage endpoints owned by this grant |
| `GET /webhooks/{id}/deliveries` · `POST /webhooks/{id}/deliveries/{deliveryId}/redeliver` | same | Delivery log (status, attempts, last response code, truncated body) and manual replay |
| `GET /events?cursor=&types=` | `<svc>:events:read` (granted together with webhooks) | **Polling fallback** — the tenant's event log in order, `{ items: Event[], nextCursor }`. Retained 7 days. Lets the Hub heal missed webhooks |

Webhook URL rules (SSRF protection — the Service makes outbound requests to a caller-supplied URL): `https` only in
production; resolve DNS and **reject loopback, link-local, private (RFC 1918/4193), and metadata IPs** (re-check at
delivery time, do not follow redirects); 5 s connect + 10 s total timeout; max 5 endpoints per grant.

### 5. Events (outbound webhooks)

Envelope (the body, exactly this shape):
```json
{ "id": "evt_01J…", "type": "board.approved", "apiVersion": "cp1", "service": "slate",
  "occurredAt": "2026-01-01T10:00:00.000Z", "tenantId": "…",
  "actor": { "id": "…", "name": "…", "kind": "user|system|connector" },
  "externalRef": { "hubProjectId": "…", "hubRunId": "…", "hubStepId": "…" },
  "data": { /* event specific, documented per event in the manifest */ } }
```
Headers: `X-CP-Event: <type>`, `X-CP-Delivery: <uuid>` (unique per attempt group, stable across retries),
`X-CP-Timestamp: <unix seconds>`, `X-CP-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>`,
`User-Agent: <Service>-Connector/1.0`.

Delivery semantics:
- **At-least-once.** Consumers dedupe on `id`. Ordering is not guaranteed; consumers use `occurredAt`.
- **Transactional outbox:** the event row is written in the **same transaction/mutation as the state change** that
  caused it, then dispatched asynchronously by a worker/scheduler. A crash between the two must not lose the event, and
  a rolled-back change must not emit one.
- Success = any `2xx` within 10 s. Otherwise retry with backoff: 10 s, 30 s, 2 m, 10 m, 30 m, 1 h, 3 h, 6 h (8 attempts,
  ≈ 11 h) with ±20 % jitter. `410 Gone` ⇒ disable the endpoint immediately. 50 consecutive failed deliveries or 3 days of
  failures ⇒ mark endpoint `disabled` (reason recorded, visible in the Service UI and via `GET /webhooks/{id}`).
- Event types are `noun.verb` (past tense / state), lower-case, e.g. `deployment.ready`. Subscriptions accept exact
  types and `prefix.*`; filter **before** enqueueing deliveries.
- Only emit events for entities inside the grant's pinned tenant and only if the grant's scopes would allow *reading*
  the entity. Never put secrets, tokens, env var values, or raw PII beyond what the matching resource returns in `data`.
- High-frequency changes must be **coalesced** (documented per event) so the Hub is never flooded.
- Each event is also appended to the tenant's event log used by `GET /events`.

### 6. Security checklist (applies to every Service)

- Tenant isolation is enforced in the data-access layer, not only in route handlers; add tests with two tenants.
- Scopes are least-privilege and checked per endpoint; the user's live role caps the scopes.
- Tokens/secrets: hashed (tokens) or encrypted at rest with AES-256-GCM and a versioned key (webhook secrets, which must
  be recoverable to sign). Never return stored third-party credentials (Google/Notion/GitHub/Razorpay/Clerk tokens)
  from any connector endpoint.
- Constant-time comparisons for all secrets and signatures. Reject webhook-registration URLs failing the SSRF rules.
- All connector calls are written to the Service's audit/activity log as `via: "connector"` with the client id, grant id,
  action name and request id (no payloads with sensitive content).
- Keep the Service's existing anti-clickjacking headers on every route **except** the optional `/embed/*` routes (§8).
- Feature flag: the whole connector (routes, UI entries, outbox writers) is disabled unless `CONNECTOR_ENABLED=true`.
  With the flag off the Service behaves byte-for-byte as before (no new queries on hot paths).
- Never break or slow existing user flows: connector code must not add latency to normal UI mutations beyond one
  outbox insert, and event dispatch must never run inline in a user-facing request.

### 7. User-facing UI every Service adds

1. **Consent page** `/connect/authorize` (see 2.1) in the Service's existing design language.
2. **Connected apps** section in the Service's settings: list active grants (client name, tenant, scopes, connected
   by, created, last used), **Revoke** button with confirm dialog, webhook endpoint health (active / disabled +
   reason, last delivery status), and "Recent connector activity" (last 20 audited calls). Empty state explains what a
   connection does.
3. Small, tasteful indicator wherever the Service creates something *via* the Hub ("Created via <Hub name>").

### 8. Optional (Phase 2): embed sessions

Do **not** iframe full apps by default. Offer deep links (`webUrl`). If an embed is implemented:
- `POST /actions/embed.createSession` `{ resource: {type,id}, mode: "view" }` ⇒ `{ url, expiresAt }`; the URL carries a
  single-use ticket (TTL 60 s) exchanged on load for a short-lived, resource-scoped session cookie
  (`SameSite=None; Secure; HttpOnly; Partitioned`) that does **not** depend on the Service's normal auth provider
  (third-party cookies in iframes are unreliable for those).
- Only `/embed/*` routes get `Content-Security-Policy: frame-ancestors <CONNECTOR_ALLOWED_EMBED_ORIGINS>`; every other
  route keeps its existing frame protection.
- `postMessage` bridge with strict origin checks: `cp:ready`, `cp:resize {height}`, `cp:navigate {url}`, `cp:event {…}`.

### 9. Conformance (what will be tested against your implementation)

`C01` manifest valid & matches registry · `C02` PKCE required; wrong verifier fails · `C03` code single-use · `C04`
exact redirect_uri match · `C05` refresh rotation + reuse detection · `C06` revoke works immediately · `C07` scope
enforcement per endpoint · `C08` cross-tenant ids return 404 · `C09` user role downgrade takes effect on the next call ·
`C10` idempotent replay / conflict · `C11` error shape on every failure path · `C12` pagination cursors · `C13` rate
limit headers + 429 · `C14` async action ⇒ 202 + operation reaches terminal state · `C15` webhook register returns secret
once; signature verifies; timestamp present · `C16` retries with backoff; `410` disables · `C17` SSRF rejects private
URLs · `C18` events include `externalRef` echoed from the creating action · `C19` outbox: event exists iff the change
committed · `C20` `GET /events` replays what webhooks delivered · `C21` no secret material in any response · `C22`
feature flag off ⇒ all connect routes `404`.

## 4. Slate-specific design

### 4.1 Tenancy & identity mapping
- **Tenant = Slate workspace** (`workspaces`, roles `Admin | Editor | Viewer` via `workspace_members`). A grant is pinned
  to one `workspaceId`. The consent page lists only workspaces where the user is a member; write scopes are offered only
  where the user is Admin/Editor.
- **Acting user = the Clerk user** who consented (`users.clerkId`). All permission checks run as that user.
- Plan/limits come from `lib/billing` (`effectiveTier`, `limitsFor`): free = 3 boards + 15 AI credits/month. Map limit
  failures to `402 plan_limit` with `{ limit, resetsAt }`. AI credits are consumed from the **consenting user's** balance
  (same `reserveAiCredit` / `refundAiCredit` flow as the UI) — surface `credits: {used, cap, remaining}` in outputs.

### 4.2 Scopes
`slate:workspaces:read`, `slate:boards:read`, `slate:boards:write`, `slate:ai:generate`, `slate:comments:read`,
`slate:events:read`, `slate:webhooks:manage`. (`slate:ai:generate` is separate because it spends credits.)

### 4.3 Data model additions (MongoDB; create indexes in the same place the existing ones are created, `lib/db/mongo.ts`)
`connector_codes` (TTL 60 s), `connector_grants` (`_id`, `clientId`, `userId`, `workspaceId`, `scopes[]`,
`accessHash`, `accessExpiresAt`, `refreshHash`, `refreshFamilyId`, `refreshExpiresAt`, `createdAt`, `lastUsedAt`,
`revokedAt?`; unique on hashes), `connector_webhooks` (endpoint, events filter, `secretEnc` AES-256-GCM, status,
disabledReason, failure counters), `connector_events` (the **outbox + event log**: `_id` ULID, `workspaceId`, `type`,
`occurredAt`, `payload`, `externalRef`, `cursor` monotonic per workspace; TTL 7 d), `connector_deliveries` (event ×
endpoint, attempts, nextAttemptAt, lastStatus, lastBody truncated), `connector_operations` (async actions, TTL 7 d),
`connector_idempotency` (TTL 24 h), `connector_audit` (TTL 90 d), `connector_ratelimits` (TTL, reuse the existing
`rateLimits` helper pattern). Add `status?: "draft"|"in_review"|"approved"`, `statusChangedAt?`, `statusChangedBy?`,
`metadata?`, `externalRef?` and `createdVia?: "ui"|"connector"` to `SlateDoc` (all optional ⇒ no migration needed).
Write a small `lib/connector/` module tree: `auth/`, `registry/`, `actions/`, `resources/`, `events/`, `webhooks/`,
`oauth/`, `crypto.ts`, `errors.ts`, `idempotency.ts`, `ratelimit.ts`, `audit.ts`.

### 4.4 Action registry (single source of truth)
Define each action once (`name`, `scopes`, `async`, zod `input`, zod `output`, handler `(ctx, input, grant) => output`).
The manifest, OpenAPI, input validation and docs are all generated from it. Routes: `app/api/connect/v1/...`
(`manifest`, `health`, `me`, `openapi.json`, `actions/[name]`, `operations/[id]`, `webhooks/...`, `events`,
`oauth/token`, `oauth/revoke`, resource routes) plus `app/connect/authorize/page.tsx` and
`app/.well-known/ecosystem-connector.json/route.ts`.

### 4.5 Actions (inputs abbreviated; write full zod schemas with descriptions/examples)

| Action | Scope | Sync? | Behavior |
|---|---|---|---|
| `boards.create` | boards:write | sync | `{ title, template?: string (a built-in template id), thumbnailIcon?, metadata?, externalRef? }` ⇒ `{ board }`. Uses `slates.create` (board limit applies) in the grant's workspace. |
| `boards.generateDiagram` | ai:generate + boards:write | **async** | `{ boardId? , title? (creates a board if no boardId), prompt (≤2000), kind: auto\|architecture\|flowchart\|erd\|mindmap\|sequence, complexity, mode: "replace"\|"append", document?: { markdown (≤50k), mode: "replace"\|"append" }, externalRef?, metadata? }`. Runs the *same* pipeline as `/api/ai/generate` (rate limit, credit reserve/refund, model chain, repair) without streaming to a browser, lays the graph out **server-side**, writes elements via `elements.apply` semantics (one undo-able "diagram" group, `diagramId` set so "Edit this diagram" still works), optionally writes `document.markdown` into the Docs pane (this is how the Hub puts the full meeting summary next to the diagram while the prompt stays short). Output: `{ board, diagram: { nodes, edges, groups, kind }, dsl, warnings[], model, credits }`. Emits `board.generation.started/completed/failed`. |
| `boards.importDsl` | boards:write | sync | `{ boardId? , title?, dsl, mode }` ⇒ parse with `parseDsl`; return parse errors with line numbers as `validation_failed.details`. No AI credit. |
| `boards.importCode` | boards:write | sync* | `{ boardId?, title?, content, format: auto\|docker-compose\|sql\|tree }` ⇒ exact parsers from `lib/import` and writes the generated documentation to the Docs pane. `auto` falls back to AI only if `slate:ai:generate` was granted (then async). |
| `boards.setDocument` | boards:write | sync | `{ boardId, markdown, mode: replace\|append }` ⇒ converts Markdown to the editor's JSON (`documentJson`) **and** `documentText`; size-capped like the UI. |
| `boards.setStatus` | boards:write | sync | `{ boardId, status: draft\|in_review\|approved, note? }` — only Admin/Editor. Emits `board.status_changed` and, when `approved`, `board.approved`. |
| `boards.setSharing` | boards:write | sync | `{ boardId, linkAccess: none\|view\|edit }` ⇒ returns the public URL when ≠ none. |
| `boards.review` | boards:read (+ai:generate for `mode:"ai"`) | sync/async | `{ boardId, mode: "structural"\|"ai" }` ⇒ the existing architecture review (instant structural check, or 1-credit AI written review). |
| `boards.estimateCost` | boards:read | sync | `{ boardId }` ⇒ FinOps estimate: `{ monthlyUsd, byComponent[], tips[] }` — **always return the itemized list through the connector** (it is the Hub's "cost before you deploy" signal; if you decide to keep itemization behind Pro, return only the total on Free and document it). |
| `boards.analyzeResilience` | boards:read | sync | `{ boardId }` ⇒ single points of failure from `lib/simulation/topology.ts`. |
| `boards.export` | boards:read | sync | `{ boardId, format: dsl\|json\|svg\|markdown }` ⇒ inline `{ format, content, bytes }` (≤1 MB; larger ⇒ `413`). `markdown` = the doc pane + a DSL block + a Mermaid-compatible block if feasible. `png` is optional (Phase 2, signed URL valid 10 min). |
| `boards.archive` | boards:write | sync | Soft-archive (no hard delete via the connector in v1). |
| `comments.add` | boards:write | sync | `{ boardId, body, anchor? }` — optional, Phase 2. |

Rules: every action that creates or changes a board stores `externalRef`/`metadata`, writes an audit row, honors
idempotency keys, and returns `board.webUrl` (`/canvas/<id>`). Never expose `elements` rows wholesale; exports are the
contract.

### 4.6 Resources (all paginated unless noted)
`GET /workspaces` (the pinned one + role), `GET /boards?query=&status=&updatedSince=`, `GET /boards/{id}`
(title, status, nodes/connectors stats from `slateStats`, linkAccess, `webUrl`, thumbnailIcon, timestamps, metadata),
`GET /boards/{id}/document` (markdown + text), `GET /boards/{id}/dsl`, `GET /boards/{id}/graph` (semantic graph via
`graphFromElements`), `GET /boards/{id}/comments`, `GET /templates` (built-in templates: id, title, kind),
`GET /me` (adds `capabilities: { aiAvailable, aiCreditsRemaining, boardsUsed, boardsCap }`).

### 4.7 Events (namespace `board.*`, `comment.*`) — payload `data` shapes
- `board.created` `{ board }`, `board.archived` `{ board }`
- `board.updated` `{ board, stats }` — **coalesced**: at most one per board per 60 s (use `lastEdited`; emit from the same
  debounced path that already touches `slates.lastEdited`, never per element write)
- `board.generation.started|completed|failed` `{ board, operationId, diagram?, error? }`
- `board.status_changed` `{ board, from, to, note?, by }` and `board.approved` `{ board, note?, by, stats, dslBytes }`
- `board.shared` `{ board, linkAccess }`
- `comment.created` `{ board, comment: { id, authorName, body, createdAt } }`
Emit with the **transactional outbox** requirement of CP1 (MongoDB multi-document transaction on a replica set, which
Atlas provides; fall back to "insert event right after the change + a reconciliation sweep" only where the repo already
runs on a standalone mongod, and document the trade-off). Dispatch from a worker: add a `scripts/connector-dispatcher.ts`
loop, and also start it inside the existing realtime server process behind `CONNECTOR_DISPATCHER=inline` so small
deployments need no extra service. Use change streams or a short polling interval for `nextAttemptAt`.

### 4.8 UI additions (match Slate's existing components/theme; minimal)
1. `app/connect/authorize/page.tsx` — consent screen (Clerk-protected; redirect to sign-in preserving the query).
2. Workspace settings → **Connected apps** panel (see CP1 §7) in `components/dashboard/WorkspaceSettings.tsx`.
3. **Board status pill** in `TopBar` (Draft / In review / Approved) with a menu; changing it calls the same server logic
   as `boards.setStatus` (so approving in the UI emits `board.approved` for the Hub). Show who approved and when. Only
   Admin/Editor see the menu; Viewers see the pill read-only. Also surface status on dashboard `BoardCard`.
4. A subtle "Created via <Hub name>" badge in the board header when `createdVia === "connector"`.

### 4.9 Environment (add to `.env.example`, document each)
`CONNECTOR_ENABLED=false`, `CONNECTOR_HUB_NAME`, `CONNECTOR_HUB_CLIENT_ID`, `CONNECTOR_HUB_CLIENT_SECRET`,
`CONNECTOR_HUB_REDIRECT_URIS`, `CONNECTOR_TOKEN_PEPPER` (32+ bytes), `CONNECTOR_ENCRYPTION_KEY` (64 hex, AES-256-GCM,
`…_PREVIOUS` for rotation), `CONNECTOR_ALLOWED_EMBED_ORIGINS` (Phase 2), `CONNECTOR_DISPATCHER=inline|external`.
Fail fast at boot with a clear message if `CONNECTOR_ENABLED=true` and any required value is missing/weak.

## 5. Phases (commit after each; run `npm run typecheck && npm run lint && npm test` before every commit)

1. **Foundation** — `lib/connector` skeleton, env validation, token crypto, error model, request-id, rate limit,
   idempotency, audit, indexes, feature flag, `manifest`/`health`/`openapi.json`, well-known route. *Done when:* flag off ⇒
   all connect routes `404` and the existing test-suite is untouched; flag on ⇒ manifest validates.
2. **OAuth** — authorize page + consent, code, token, refresh rotation + reuse detection, revoke, `GET /me`, Connected
   apps panel. *Done when:* a scripted PKCE flow works end-to-end in tests and revoking blocks the very next call.
3. **Read side** — resources + scope/role/tenant enforcement. *Done when:* two-workspace tests prove isolation (cross-tenant
   id ⇒ 404) and a role downgrade is effective on the next call.
4. **Write side** — `boards.create/importDsl/importCode/setDocument/setStatus/setSharing/export/archive`, status pill UI,
   idempotency, operations table.
5. **AI side** — server-side layout shim + `boards.generateDiagram` (async operation), credit reserve/refund, `review`,
   `estimateCost`, `analyzeResilience`. *Done when:* with a mocked model, a prompt yields a board with no overlapping
   nodes and the Docs pane filled; credits refunded on failure; limits ⇒ `402 plan_limit`.
6. **Events** — outbox, dispatcher, webhook CRUD, signing, retries/backoff/disable, `GET /events`, deliveries log,
   SSRF guard. *Done when:* a local receiver verifies signatures; killing the receiver exercises retry; `410` disables.
7. **Hardening & docs** — OpenAPI, `docs/CONNECTOR.md` (flow diagrams, curl examples for every action, event catalog with
   example payloads, env, security notes, runbook), a `scripts/connector-smoke.ts` that runs the full lifecycle against a
   running instance, and the conformance checklist C01–C22 as automated tests.
8. *(Optional)* Embed sessions (CP1 §8): **view-only** board embed at `/embed/canvas/[id]`; remember the realtime server
   verifies *Clerk* tokens on `join`, so an embed needs its own token path in `lib/realtime` — keep it read-only and
   behind `CONNECTOR_ALLOWED_EMBED_ORIGINS`.

## 6. Quality bar

- TypeScript strict, no `any` in new code, zod on every boundary, no secrets in logs, consistent error model.
- Tests: unit (crypto, PKCE, signatures, backoff schedule, SSRF guard), database (two-tenant isolation, outbox
  atomicity, idempotency, TTLs) using `mongodb-memory-server`, and API-level tests that call the route handlers.
- Don't introduce new heavy dependencies without justification (prefer `node:crypto`, existing `zod`, `ws`, `svix`-style
  HMAC by hand). Document any dependency you add.
- Performance: the connector must add **no** work to canvas pointer/realtime hot paths; event emission is one indexed
  insert off the debounced write path.
- Finish with a short report: what was built per phase, test results, deviations from CP1 (should be none), known
  limitations, and the exact env/setup steps to enable it in production.
