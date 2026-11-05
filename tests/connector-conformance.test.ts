import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GET as wellKnown } from "@/app/.well-known/ecosystem-connector.json/route";
import { GET as readRoute } from "@/app/api/connect/v1/[...path]/route";
import { POST as actionRoute } from "@/app/api/connect/v1/actions/[name]/route";
import { GET as eventsRoute } from "@/app/api/connect/v1/events/route";
import { GET as meRoute } from "@/app/api/connect/v1/me/route";
import { POST as revokeRoute } from "@/app/api/connect/v1/oauth/revoke/route";
import { POST as tokenRoute } from "@/app/api/connect/v1/oauth/token/route";
import { GET as opRoute } from "@/app/api/connect/v1/operations/[id]/route";
import { GET as hooksList, POST as hooksCreate } from "@/app/api/connect/v1/webhooks/route";
import { streamChat } from "@/lib/ai/nvidia";
import { pkceChallenge, verifyWebhookSignature } from "@/lib/connector/crypto";
import { settleDeferred } from "@/lib/connector/defer";
import { deliverDue, fanOut } from "@/lib/connector/events/dispatcher";
import { inOutbox } from "@/lib/connector/events/outbox";
import { emitEvent } from "@/lib/connector/events/emit";
import { createAuthCode } from "@/lib/connector/oauth/grants";
import { registry } from "@/lib/connector/registry";
import { buildManifest, manifestSchema } from "@/lib/connector/registry/manifest";
import { isBlockedIp } from "@/lib/connector/webhooks/ssrf";
import type { Scope } from "@/lib/connector/scopes";
import { getCollections } from "@/lib/db/mongo";
import { basicAuth, bearer, disableConnector, enableConnector, HUB, makeGrant, req, seedUsers } from "./helpers/connector";
import { EDITOR, OWNER, resetDb, setup, startReplDb, stopDb } from "./helpers/db";

/**
 * The CP1 conformance checklist, C01-C22, run against the route handlers on a one-node replica set (so that
 * transactions, and therefore the outbox, are real). Most items have deeper tests in the other connector test files;
 * this file is the single place that states each one.
 */

vi.mock("@/lib/ai/nvidia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/nvidia")>();
  return { ...actual, streamChat: vi.fn() };
});
const model = streamChat as unknown as Mock;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ALL: Scope[] = ["slate:workspaces:read", "slate:boards:read", "slate:boards:write", "slate:ai:generate", "slate:comments:read", "slate:events:read", "slate:webhooks:manage"];
const GRAPH = { kind: "architecture", title: "G", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] };

let receiver: http.Server;
let hookUrl = "";
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let answer = 200;

beforeAll(async () => {
  enableConnector();
  process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS = "true";
  process.env.NVIDIA_API_KEY = "test-key";
  await startReplDb();
  receiver = http.createServer((rq, rs) => {
    const chunks: Buffer[] = [];
    rq.on("data", (d) => chunks.push(d));
    rq.on("end", () => {
      received.push({ headers: rq.headers, body: Buffer.concat(chunks).toString("utf8") });
      rs.statusCode = answer;
      rs.end("ok");
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/h`;
});
afterAll(async () => {
  await new Promise((resolve) => receiver.close(resolve));
  await stopDb();
  disableConnector();
  delete process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS;
  delete process.env.NVIDIA_API_KEY;
});
beforeEach(async () => {
  await resetDb();
  await seedUsers();
  received.length = 0;
  answer = 200;
  model.mockReset();
  model.mockResolvedValue({ text: JSON.stringify(GRAPH), finishReason: "stop" });
});

async function connected(userId = EDITOR.subject, scopes: readonly Scope[] = ALL) {
  const ctx = await setup();
  const grant = await makeGrant({ userId, workspaceId: ctx.workspaceId, scopes });
  return { ...ctx, token: grant.accessToken, refresh: grant.refreshToken, grantId: grant.grantId };
}
const act = async (token: string, name: string, input: unknown, headers: Record<string, string> = {}) => {
  const res = await actionRoute(req(`/api/connect/v1/actions/${name}`, { headers: bearer(token, headers), body: { input } }), { params: Promise.resolve({ name }) });
  return { res, body: (await res.json()) as Json };
};
const get = async (token: string, path: string) => {
  const res = await readRoute(req(`/api/connect/v1${path}`, { headers: bearer(token) }), { params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }) });
  return { res, body: (await res.json()) as Json };
};
const form = (route: (r: Request) => Promise<Response>, path: string, params: Record<string, string>, auth = basicAuth()) =>
  route(req(path, { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, rawBody: new URLSearchParams(params).toString() }));
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
async function codeFor(workspaceId: string) {
  return createAuthCode({ clientId: HUB.clientId, userId: EDITOR.subject, workspaceId, scopes: ["slate:boards:read"], redirectUri: HUB.redirectUri, codeChallenge: pkceChallenge(VERIFIER) });
}

describe("C01 manifest valid and matches the registry", () => {
  it("is served at both URLs, validates, and lists exactly what the registry declares", async () => {
    const res = await wellKnown(req("/.well-known/ecosystem-connector.json"));
    const manifest = await res.json();
    expect(manifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest).toEqual(JSON.parse(JSON.stringify(buildManifest(registry, { baseUrl: "https://slate.test" }))));
    expect(manifest.actions.map((a: Json) => a.name).sort()).toEqual(registry.actions.map((a) => a.name).sort());
    expect(manifest.events.map((e: Json) => e.type).sort()).toEqual(registry.events.map((e) => e.type).sort());
  });

  it("describes inputs the way the Hub renders forms from, and every action and resource is really served", async () => {
    const { token } = await connected();
    const manifest = await (await wellKnown(req("/.well-known/ecosystem-connector.json"))).json();
    for (const a of manifest.actions as Json[]) {
      expect(a.inputSchema.type, a.name).toBe("object");
      expect(a.inputSchema.additionalProperties, a.name).toBe(false);
      const described = Object.values(a.inputSchema.properties as Record<string, Json>).filter((p) => p.title || p.description);
      expect(described.length, `${a.name} has no titles or descriptions`).toBeGreaterThan(0);
      const probe = await act(token, a.name, { __probe__: true }); // reaches the action's own validation, never a 404
      expect(probe.res.status, a.name).toBe(400);
    }
    for (const r of manifest.resources as Json[]) {
      const path = r.path.replace("{id}", "000000000000000000000000");
      expect((await get(token, path)).res.status, r.path).not.toBe(405);
    }
  });
});

describe("C02-C06 OAuth", () => {
  it("C02 PKCE is required and a wrong verifier fails", async () => {
    const { workspaceId } = await connected();
    const code = await codeFor(workspaceId);
    expect((await form(tokenRoute, "/t", { grant_type: "authorization_code", code, redirect_uri: HUB.redirectUri, code_verifier: "A".repeat(43) })).status).toBe(400);
    expect((await form(tokenRoute, "/t", { grant_type: "authorization_code", code: await codeFor(workspaceId), redirect_uri: HUB.redirectUri })).status).toBe(400);
  });

  it("C03 a code is single use and the second use revokes what the first produced", async () => {
    const { workspaceId } = await connected();
    const code = await codeFor(workspaceId);
    const params = { grant_type: "authorization_code", code, redirect_uri: HUB.redirectUri, code_verifier: VERIFIER };
    const first = await (await form(tokenRoute, "/t", params)).json();
    expect((await meRoute(req("/me", { headers: bearer(first.access_token) }))).status).toBe(200);
    expect((await form(tokenRoute, "/t", params)).status).toBe(400);
    expect((await meRoute(req("/me", { headers: bearer(first.access_token) }))).status).toBe(401);
  });

  it("C04 the redirect_uri must match exactly", async () => {
    const { workspaceId } = await connected();
    const res = await form(tokenRoute, "/t", { grant_type: "authorization_code", code: await codeFor(workspaceId), redirect_uri: HUB.redirectUri + "/", code_verifier: VERIFIER });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("C05 refresh tokens rotate and a reused one revokes the grant", async () => {
    const { workspaceId } = await connected();
    const t1 = await (await form(tokenRoute, "/t", { grant_type: "authorization_code", code: await codeFor(workspaceId), redirect_uri: HUB.redirectUri, code_verifier: VERIFIER })).json();
    const t2 = await (await form(tokenRoute, "/t", { grant_type: "refresh_token", refresh_token: t1.refresh_token })).json();
    expect(t2.refresh_token).not.toBe(t1.refresh_token);
    expect((await form(tokenRoute, "/t", { grant_type: "refresh_token", refresh_token: t1.refresh_token })).status).toBe(400);
    expect((await meRoute(req("/me", { headers: bearer(t2.access_token) }))).status).toBe(401);
  });

  it("C06 revoking works immediately", async () => {
    const { workspaceId } = await connected();
    const t = await (await form(tokenRoute, "/t", { grant_type: "authorization_code", code: await codeFor(workspaceId), redirect_uri: HUB.redirectUri, code_verifier: VERIFIER })).json();
    expect((await form(revokeRoute, "/r", { token: t.access_token })).status).toBe(200);
    expect((await meRoute(req("/me", { headers: bearer(t.access_token) }))).status).toBe(401);
  });
});

describe("C07-C13 access rules and conventions", () => {
  it("C07 scopes are enforced per endpoint", async () => {
    const { token } = await connected(EDITOR.subject, ["slate:boards:read"]);
    expect((await act(token, "boards.create", { title: "x" })).body.error).toMatchObject({ code: "insufficient_scope", requiredScope: "slate:boards:write" });
    expect((await get(token, "/workspaces")).body.error.code).toBe("insufficient_scope");
    expect((await get(token, "/boards")).res.status).toBe(200);
  });

  it("C08 another workspace's ids are 404", async () => {
    const { token } = await connected();
    const c = await getCollections();
    await c.workspaces.insertOne({ _id: "ws_b", name: "B", ownerId: "user_stranger", createdAt: 1, updatedAt: 1 });
    await c.slates.insertOne({ _id: "board_b", title: "B", workspaceId: "ws_b", isArchived: false, createdAt: 1, lastEdited: 1, thumbnailIcon: "1", schemaVersion: 2, elementSeq: 0 });
    for (const p of ["/boards/board_b", "/boards/board_b/document", "/boards/board_b/graph"]) expect((await get(token, p)).res.status, p).toBe(404);
    const inputs: Record<string, Json> = { "boards.archive": { boardId: "board_b" }, "boards.export": { boardId: "board_b", format: "json" }, "boards.estimateCost": { boardId: "board_b" }, "boards.setStatus": { boardId: "board_b", status: "approved" } };
    for (const [a, input] of Object.entries(inputs)) expect((await act(token, a, input)).res.status, a).toBe(404);
  });

  it("C09 a role downgrade takes effect on the next call", async () => {
    const { token, workspaceId } = await connected();
    expect((await act(token, "boards.create", { title: "a" })).res.status).toBe(200);
    const c = await getCollections();
    await c.workspaceMembers.updateOne({ workspaceId, userId: EDITOR.subject }, { $set: { role: "Viewer" } });
    expect((await act(token, "boards.create", { title: "b" })).res.status).toBe(403);
  });

  it("C10 idempotent replay and conflict", async () => {
    const { token } = await connected();
    const a = await act(token, "boards.create", { title: "k" }, { "idempotency-key": "c10" });
    const b = await act(token, "boards.create", { title: "k" }, { "idempotency-key": "c10" });
    expect(b.res.headers.get("idempotent-replay")).toBe("true");
    expect(b.body).toEqual(a.body);
    expect((await act(token, "boards.create", { title: "other" }, { "idempotency-key": "c10" })).res.status).toBe(422);
  });

  it("C11 every failure path answers in the error shape", async () => {
    const { token } = await connected();
    const failures = [
      await get("bad-token", "/boards"),
      await get(token, "/boards?limit=0"),
      await get(token, "/boards/nope"),
      await get(token, "/nope"),
      await act(token, "boards.create", { title: "" }),
      await act(token, "no.such", {}),
      await act(token, "boards.setStatus", { boardId: "x", status: "weird" }),
    ];
    for (const f of failures) {
      expect(f.res.headers.get("content-type")).toContain("application/json");
      expect(f.body.error).toMatchObject({ code: expect.any(String), message: expect.any(String), retryable: expect.any(Boolean), requestId: f.res.headers.get("x-request-id") });
    }
  });

  it("C12 pagination returns opaque cursors and no duplicates", async () => {
    const { token, workspaceId } = await connected();
    const c = await getCollections();
    for (let i = 0; i < 5; i++) await c.slates.insertOne({ _id: `p${i}`, title: `P${i}`, workspaceId, isArchived: false, createdAt: i, lastEdited: 100 + i, thumbnailIcon: "1", schemaVersion: 2, elementSeq: 0 });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 10; pages++) {
      const r: { body: Json } = await get(token, `/boards?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...r.body.items.map((b: Json) => b.id));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("C13 rate limit headers on every response and 429 with Retry-After when exceeded", async () => {
    const { token } = await connected();
    const first = await meRoute(req("/me", { headers: bearer(token) }));
    expect(first.headers.get("x-ratelimit-limit")).toBe("120");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("119");
    expect(Number(first.headers.get("x-ratelimit-reset"))).toBeGreaterThan(0);
    let last = first;
    for (let i = 0; i < 120; i++) last = await meRoute(req("/me", { headers: bearer(token) }));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("C14 asynchronous actions", () => {
  it("answers 202 and the operation reaches a terminal state", async () => {
    const { token } = await connected();
    const { res, body } = await act(token, "boards.generateDiagram", { prompt: "two services talking" });
    expect(res.status).toBe(202);
    expect(body.operation).toMatchObject({ status: "pending", pollUrl: expect.stringContaining(body.operation.id) });
    await settleDeferred();
    const done = await (await opRoute(req("/o", { headers: bearer(token) }), { params: Promise.resolve({ id: body.operation.id }) })).json();
    expect(["succeeded", "failed"]).toContain(done.status);
    expect(done.status).toBe("succeeded");
  });
});

describe("C15-C18, C20 webhooks and events", () => {
  async function register(token: string, events = ["board.*"]) {
    const res = await hooksCreate(req("/w", { headers: bearer(token), body: { url: hookUrl, events } }));
    return { res, body: (await res.json()) as Json };
  }

  it("C15 the secret is returned once, deliveries are signed and carry a timestamp", async () => {
    const { token } = await connected();
    const hook = await register(token);
    expect(hook.body.secret).toMatch(/^whsec_/);
    expect(JSON.stringify(await (await hooksList(req("/w", { headers: bearer(token) }))).json())).not.toContain("whsec_");
    await act(token, "boards.create", { title: "signed" });
    await fanOut();
    await deliverDue();
    expect(received).toHaveLength(1);
    const ts = Number(received[0].headers["x-cp-timestamp"]);
    expect(ts).toBeGreaterThan(0);
    expect(verifyWebhookSignature(hook.body.secret, ts, received[0].body, String(received[0].headers["x-cp-signature"]))).toBe(true);
    expect(received[0].headers["x-cp-event"]).toBe("board.created");
  });

  it("C16 failed deliveries are retried with backoff and 410 disables the endpoint", async () => {
    const { token } = await connected();
    const hook = await register(token);
    answer = 500;
    await act(token, "boards.create", { title: "retry" });
    await fanOut();
    await deliverDue();
    const c = await getCollections();
    const d = (await c.connectorDeliveries.findOne({}))!;
    expect(d).toMatchObject({ status: "pending", attempts: 1 });
    expect(d.nextAttemptAt - Date.now()).toBeGreaterThan(7_000);
    answer = 410;
    await c.connectorDeliveries.updateOne({ _id: d._id }, { $set: { nextAttemptAt: Date.now() - 1 } });
    await deliverDue();
    expect((await c.connectorWebhooks.findOne({ _id: hook.body.id }))!.status).toBe("disabled");
  });

  it("C17 private and internal URLs are rejected", async () => {
    const { token } = await connected();
    delete process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS;
    try {
      // (plain http is refused in production only; the unit tests cover that rule)
      for (const url of ["https://127.0.0.1/h", "https://169.254.169.254/h", "https://[fd00:ec2::254]/h", "https://10.0.0.1/h", "https://localhost/h"]) {
        const res = await hooksCreate(req("/w", { headers: bearer(token), body: { url, events: ["board.*"] } }));
        expect(res.status, url).toBe(400);
      }
    } finally {
      process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS = "true";
    }
    expect(isBlockedIp("192.168.0.1")).toBe(true);
  });

  it("C18 events echo the externalRef given when the board was created", async () => {
    const { token } = await connected();
    await register(token);
    const created = await act(token, "boards.create", { title: "ref", externalRef: { hubProjectId: "p", hubRunId: "r", hubStepId: "s" } });
    await act(token, "boards.setStatus", { boardId: created.body.output.board.id, status: "approved" });
    await fanOut();
    await deliverDue();
    expect(received.length).toBeGreaterThanOrEqual(3);
    for (const r of received) expect(JSON.parse(r.body).externalRef).toEqual({ hubProjectId: "p", hubRunId: "r", hubStepId: "s" });
  });

  it("C20 GET /events replays what the webhooks delivered", async () => {
    const { token } = await connected();
    await register(token);
    await act(token, "boards.create", { title: "log" });
    await fanOut();
    await deliverDue();
    const log = await (await eventsRoute(req("/e", { headers: bearer(token) }))).json();
    expect(log.items.map((e: Json) => e.id)).toEqual(received.map((r) => JSON.parse(r.body).id));
  });
});

describe("C19 outbox: the event exists if and only if the change committed", () => {
  it("rolls back a change and its event together, and commits them together", async () => {
    const { workspaceId, slateId } = await connected();
    const c = await getCollections();
    const actor = { id: OWNER.subject, name: "O", kind: "user" as const };
    await expect(
      inOutbox(async (session) => {
        await c.slates.updateOne({ _id: slateId }, { $set: { title: "ghost" } }, { session });
        await emitEvent({ workspaceId, type: "board.updated", boardId: slateId, data: {}, actor }, session);
        throw new Error("rolled back");
      })
    ).rejects.toThrow("rolled back");
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(0);
    expect((await c.slates.findOne({ _id: slateId }))!.title).toBe("Board");

    await inOutbox(async (session) => {
      await c.slates.updateOne({ _id: slateId }, { $set: { title: "real" } }, { session });
      await emitEvent({ workspaceId, type: "board.updated", boardId: slateId, data: {}, actor }, session);
    });
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(1);
    expect((await c.slates.findOne({ _id: slateId }))!.title).toBe("real");
  });
});

describe("C21 no secret material in any response", () => {
  it("never returns tokens, hashes, keys or stored secrets from any endpoint", async () => {
    const { token, refresh, slateId } = await connected();
    await hooksCreate(req("/w", { headers: bearer(token), body: { url: hookUrl, events: ["board.*"] } }));
    await act(token, "boards.create", { title: "s" });
    const c = await getCollections();
    const stored = JSON.stringify(await c.connectorGrants.find({}).toArray());
    const bodies: string[] = [];
    for (const p of ["/workspaces", "/boards", `/boards/${slateId}`, `/boards/${slateId}/document`, `/boards/${slateId}/graph`, `/boards/${slateId}/comments`, "/templates"]) bodies.push(JSON.stringify((await get(token, p)).body));
    bodies.push(JSON.stringify(await (await meRoute(req("/me", { headers: bearer(token) }))).json()));
    bodies.push(JSON.stringify(await (await hooksList(req("/w", { headers: bearer(token) }))).json()));
    bodies.push(JSON.stringify(await (await eventsRoute(req("/e", { headers: bearer(token) }))).json()));
    bodies.push(JSON.stringify(await (await wellKnown(req("/x"))).json()));
    const joined = bodies.join("\n");
    const secrets = [HUB.pepper, HUB.clientSecret, HUB.encryptionKey, token, refresh, "whsec_", "secretEnc", "accessHash", "refreshHash", "enc:v1:", "NVIDIA", "razorpay"];
    for (const s of secrets) expect(joined, s).not.toContain(s);
    for (const hash of stored.match(/[0-9a-f]{64}/g) ?? []) expect(joined).not.toContain(hash);
  });
});

describe("C22 feature flag off means 404 everywhere", () => {
  it("answers 404 for the manifest, the API and the actions when the flag is off", async () => {
    const { token } = await connected();
    process.env.CONNECTOR_ENABLED = "false";
    try {
      expect((await wellKnown(req("/x"))).status).toBe(404);
      expect((await meRoute(req("/me", { headers: bearer(token) }))).status).toBe(404);
      expect((await act(token, "boards.create", { title: "x" })).res.status).toBe(404);
      expect((await get(token, "/boards")).res.status).toBe(404);
      expect((await form(tokenRoute, "/t", { grant_type: "refresh_token", refresh_token: "x" })).status).toBe(404);
    } finally {
      process.env.CONNECTOR_ENABLED = "true";
    }
    expect((await meRoute(req("/me", { headers: bearer(token) }))).status).toBe(200);
  });
});
