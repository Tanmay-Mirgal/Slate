import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as eventsRoute } from "@/app/api/connect/v1/events/route";
import { GET as hookGet, PATCH as hookPatch, DELETE as hookDelete } from "@/app/api/connect/v1/webhooks/[id]/route";
import { POST as redeliverRoute } from "@/app/api/connect/v1/webhooks/[id]/deliveries/[deliveryId]/redeliver/route";
import { GET as deliveriesRoute } from "@/app/api/connect/v1/webhooks/[id]/deliveries/route";
import { GET as hooksList, POST as hooksCreate } from "@/app/api/connect/v1/webhooks/route";
import { POST as actionRoute } from "@/app/api/connect/v1/actions/[name]/route";
import { RETRY_DELAYS_MS, MAX_ATTEMPTS, nextDelayMs } from "@/lib/connector/events/backoff";
import { attemptDelivery, deliverDue, fanOut, runDispatcherOnce } from "@/lib/connector/events/dispatcher";
import { decryptSecret, verifyWebhookSignature } from "@/lib/connector/crypto";
import { isBlockedIp, resolveWebhookTarget, WebhookUrlError } from "@/lib/connector/webhooks/ssrf";
import { matchesEvent } from "@/lib/connector/webhooks/store";
import type { Scope } from "@/lib/connector/scopes";
import { api } from "@/lib/client/api";
import { getCollections } from "@/lib/db/mongo";
import { bearer, disableConnector, enableConnector, makeGrant, req, seedUsers } from "./helpers/connector";
import { as, EDITOR, OWNER, resetDb, setup, startDb, stopDb, VIEWER } from "./helpers/db";

beforeAll(async () => {
  enableConnector();
  process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS = "true"; // the receiver below listens on localhost
  await startDb();
});
afterAll(async () => {
  await stopDb();
  disableConnector();
  delete process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS;
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HOOKS: Scope[] = ["slate:boards:read", "slate:boards:write", "slate:comments:read", "slate:events:read", "slate:webhooks:manage"];

/** A webhook receiver that records every request and answers with whatever `respond` says. */
interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}
let server: http.Server;
let received: Received[] = [];
let respond: () => { status: number; body?: string } = () => ({ status: 200 });
let url = "";

beforeAll(async () => {
  server = http.createServer((rq, rs) => {
    const chunks: Buffer[] = [];
    rq.on("data", (d) => chunks.push(d));
    rq.on("end", () => {
      received.push({ headers: rq.headers, body: Buffer.concat(chunks).toString("utf8") });
      const r = respond();
      rs.statusCode = r.status;
      rs.end(r.body ?? "ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  received = [];
  respond = () => ({ status: 200 });
});
afterEach(() => vi.useRealTimers());

async function connected(userId = EDITOR.subject, scopes: readonly Scope[] = HOOKS) {
  const ctx = await setup();
  const grant = await makeGrant({ userId, workspaceId: ctx.workspaceId, scopes });
  return { ...ctx, token: grant.accessToken, grantId: grant.grantId };
}

async function register(token: string, events: string[] = ["board.*"], hookUrl = url) {
  const res = await hooksCreate(req("/api/connect/v1/webhooks", { headers: bearer(token), body: { url: hookUrl, events } }));
  return { res, body: (await res.json()) as Json };
}
async function act(token: string, name: string, input: unknown) {
  const res = await actionRoute(req(`/api/connect/v1/actions/${name}`, { headers: bearer(token), body: { input } }), { params: Promise.resolve({ name }) });
  return { res, body: (await res.json()) as Json };
}
const hookParams = (id: string, extra: { deliveryId?: string } = {}) => ({ params: Promise.resolve({ id, deliveryId: extra.deliveryId ?? "" }) });
async function pump() {
  await fanOut();
  await deliverDue();
}

describe("SSRF guard (C17)", () => {
  it("blocks loopback, private, link-local, metadata and reserved addresses in every notation", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.5", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "168.63.129.16", "198.18.0.1", "192.0.2.1", "::", "::1", "fd00:ec2::254", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2002:7f00:1::", "not-an-ip"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it("rejects bad URLs at registration time with the problem named", async () => {
    const strict = { requireHttps: true, allowPrivate: false };
    const bad: [string, RegExp][] = [
      ["http://example.com/hook", /https/],
      ["https://user:pw@example.com/hook", /credentials/],
      ["https://127.0.0.1/hook", /private|internal|reserved/],
      ["https://169.254.169.254/latest/meta-data", /private|internal|reserved/],
      ["https://[::1]/hook", /private|internal|reserved/],
      ["https://localhost/hook", /internal/],
      ["https://service.internal/hook", /internal/],
      ["https://10.1.2.3:8443/hook", /private|internal|reserved/],
      ["ftp://example.com/hook", /https/],
      ["not a url", /not valid/],
    ];
    for (const [value, message] of bad) await expect(resolveWebhookTarget(value, strict), value).rejects.toThrow(message);
    await expect(resolveWebhookTarget("https://8.8.8.8/hook", strict)).resolves.toMatchObject({ ip: "8.8.8.8", family: 4 });
    expect(WebhookUrlError.name).toBe("WebhookUrlError");
  });

  it("is enforced by the API", async () => {
    const { token } = await connected();
    delete process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS;
    try {
      for (const bad of ["http://169.254.169.254/latest", "https://10.0.0.5/hook", url]) {
        const { res, body } = await register(token, ["board.*"], bad);
        expect(res.status, bad).toBe(400);
        expect(body.error.details[0].path).toBe("url");
      }
    } finally {
      process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS = "true";
    }
  });
});

describe("backoff schedule (C16)", () => {
  it("is 10s, 30s, 2m, 10m, 30m, 1h, 3h, 6h with +/-20% jitter, then gives up", () => {
    expect(RETRY_DELAYS_MS).toEqual([10_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000]);
    expect(MAX_ATTEMPTS).toBe(9);
    RETRY_DELAYS_MS.forEach((base, i) => {
      expect(nextDelayMs(i + 1, () => 0)).toBe(Math.round(base * 0.8));
      expect(nextDelayMs(i + 1, () => 1)).toBe(Math.round(base * 1.2));
      expect(nextDelayMs(i + 1, () => 0.5)).toBe(base);
    });
    expect(nextDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 3_600_000).toBeCloseTo(10.7, 0); // about eleven hours in all
  });

  it("matches exact types and prefix patterns", () => {
    expect(matchesEvent(["board.approved"], "board.approved")).toBe(true);
    expect(matchesEvent(["board.*"], "board.generation.completed")).toBe(true);
    expect(matchesEvent(["board.*"], "comment.created")).toBe(false);
    expect(matchesEvent(["board.approved"], "board.approved.extra")).toBe(false);
    expect(matchesEvent(["boar.*"], "board.created")).toBe(false);
  });
});

describe("webhook endpoints (C15)", () => {
  it("returns the secret once, stores it encrypted, and never shows it again", async () => {
    const { token, workspaceId } = await connected();
    const { res, body } = await register(token, ["board.approved", "comment.*"]);
    expect(res.status).toBe(201);
    expect(body.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43,}$/);
    expect(body).toMatchObject({ url, events: ["board.approved", "comment.*"], status: "active" });

    const c = await getCollections();
    const row = (await c.connectorWebhooks.findOne({ _id: body.id }))!;
    expect(row.secretEnc.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(body.secret);
    expect(decryptSecret(row.secretEnc, row._id)).toBe(body.secret);
    expect(row.workspaceId).toBe(workspaceId);

    const got = await hookGet(req(`/api/connect/v1/webhooks/${body.id}`, { headers: bearer(token) }), hookParams(body.id));
    expect(JSON.stringify(await got.json())).not.toContain("secret");
    const list = await (await hooksList(req("/api/connect/v1/webhooks", { headers: bearer(token) }))).json();
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("whsec_");
  });

  it("validates events and limits a connection to five endpoints", async () => {
    const { token } = await connected();
    const typo = await register(token, ["board.aproved"]);
    expect(typo.res.status).toBe(400);
    expect(typo.body.error.details[0].path).toBe("events.0");
    expect((await register(token, [])).res.status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await register(token)).res.status).toBe(201);
    const sixth = await register(token);
    expect(sixth.res.status).toBe(409);
    expect(sixth.body.error.code).toBe("conflict");
  });

  it("needs the webhooks scope and keeps endpoints private to their connection", async () => {
    const { token, workspaceId } = await connected();
    const { body } = await register(token);
    const noHooks = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: ["slate:boards:read"] });
    expect((await register(noHooks.accessToken)).res.status).toBe(403);
    const other = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: HOOKS });
    expect((await hookGet(req("/x", { headers: bearer(other.accessToken) }), hookParams(body.id))).status).toBe(404);
    expect((await hookDelete(req("/x", { method: "DELETE", headers: bearer(other.accessToken) }), hookParams(body.id))).status).toBe(404);
  });

  it("edits, disables, re-enables and deletes", async () => {
    const { token } = await connected();
    const { body } = await register(token);
    const patch = (b: unknown) => hookPatch(req("/x", { method: "PATCH", headers: bearer(token), body: b }), hookParams(body.id));
    expect(await (await patch({ events: ["board.created"], description: "prod" })).json()).toMatchObject({ events: ["board.created"], description: "prod" });
    expect((await (await patch({ status: "disabled" })).json()).disabledReason).toMatch(/connected app/);
    expect(await (await patch({ status: "active" })).json()).toMatchObject({ status: "active" });
    expect((await patch({ events: ["nope.*"] })).status).toBe(400);
    expect((await patch({ surprise: 1 })).status).toBe(400);
    expect((await hookDelete(req("/x", { method: "DELETE", headers: bearer(token) }), hookParams(body.id))).status).toBe(204);
    expect((await hookGet(req("/x", { headers: bearer(token) }), hookParams(body.id))).status).toBe(404);
  });
});

describe("delivery (C15, C16)", () => {
  it("sends signed events whose signature a receiver can verify, with timestamp and delivery headers", async () => {
    const { token, workspaceId } = await connected();
    const hook = await register(token, ["board.*"]);
    const created = await act(token, "boards.create", { title: "Delivered", externalRef: { hubRunId: "run_77" } });
    await pump();

    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.headers["x-cp-event"]).toBe("board.created");
    expect(r.headers["user-agent"]).toBe("Slate-Connector/1.0");
    expect(r.headers["content-type"]).toContain("application/json");
    const ts = Number(r.headers["x-cp-timestamp"]);
    expect(Math.abs(Date.now() / 1000 - ts)).toBeLessThan(30);
    expect(verifyWebhookSignature(hook.body.secret, ts, r.body, String(r.headers["x-cp-signature"]))).toBe(true);
    expect(verifyWebhookSignature("whsec_wrong", ts, r.body, String(r.headers["x-cp-signature"]))).toBe(false);
    expect(verifyWebhookSignature(hook.body.secret, ts, r.body + " ", String(r.headers["x-cp-signature"]))).toBe(false);

    const envelope = JSON.parse(r.body);
    expect(envelope).toMatchObject({
      id: expect.stringMatching(/^evt_[0-9A-Z]{26}$/),
      type: "board.created",
      apiVersion: "cp1",
      service: "slate",
      tenantId: workspaceId,
      occurredAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
      actor: { id: EDITOR.subject, kind: "connector" },
      externalRef: { hubRunId: "run_77" },
      data: { board: { id: created.body.output.board.id, title: "Delivered" } },
    });
    const c = await getCollections();
    const d = (await c.connectorDeliveries.findOne({}))!;
    expect(d).toMatchObject({ status: "succeeded", attempts: 1, lastStatusCode: 200 });
    expect(r.headers["x-cp-delivery"]).toBe(d.deliveryUuid);
    expect((await c.connectorWebhooks.findOne({ _id: hook.body.id }))).toMatchObject({ lastDeliveryStatus: "succeeded", consecutiveFailures: 0 });
  });

  it("filters before queueing: unsubscribed types, other workspaces, revoked grants and users who left get nothing", async () => {
    const { token, workspaceId, slateId } = await connected();
    await register(token, ["board.approved"]); // not subscribed to board.created / archived
    await act(token, "boards.create", { title: "A" });
    await act(token, "boards.setStatus", { boardId: slateId, status: "approved" });
    await fanOut();
    const c = await getCollections();
    expect((await c.connectorDeliveries.find({}).toArray()).map((d) => d.eventType)).toEqual(["board.approved"]);

    // a grant whose user left the workspace receives nothing new
    await c.connectorDeliveries.deleteMany({});
    await c.workspaceMembers.deleteOne({ workspaceId, userId: EDITOR.subject });
    await as(OWNER).mutation(api.slates.setStatus, { id: slateId, status: "draft" });
    await as(OWNER).mutation(api.slates.setStatus, { id: slateId, status: "approved" });
    await fanOut();
    expect(await c.connectorDeliveries.countDocuments({})).toBe(0);
  });

  it("only sends what the grant's scopes allow it to read", async () => {
    const { token, workspaceId } = await connected(EDITOR.subject, ["slate:boards:read", "slate:events:read", "slate:webhooks:manage"]); // no comments:read
    await register(token, ["comment.*", "board.*"]);
    const board = (await (await getCollections()).slates.findOne({ workspaceId }))!._id;
    await as(OWNER).mutation(api.comments.createThread, { slateId: board, anchor: { kind: "point", x: 1, y: 1 }, body: "hi", mentions: [] });
    await as(OWNER).mutation(api.slates.setLinkAccess, { id: board, linkAccess: "view" });
    await fanOut();
    const types = (await (await getCollections()).connectorDeliveries.find({}).toArray()).map((d) => d.eventType);
    expect(types).toEqual(["board.shared"]);
  });

  it("retries a failing endpoint on the schedule, then succeeds when it recovers", async () => {
    const { token } = await connected();
    await register(token);
    respond = () => ({ status: 500, body: "boom" });
    await act(token, "boards.create", { title: "Retry" });
    await pump();
    const c = await getCollections();
    let d = (await c.connectorDeliveries.findOne({}))!;
    expect(d).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 500, lastBody: "boom" });
    expect(d.nextAttemptAt - Date.now()).toBeGreaterThan(7_000);
    expect(d.nextAttemptAt - Date.now()).toBeLessThan(13_000);
    const uuid = d.deliveryUuid;

    await deliverDue();
    expect(received).toHaveLength(1); // not due yet: nothing is sent early

    respond = () => ({ status: 200 });
    await c.connectorDeliveries.updateOne({ _id: d._id }, { $set: { nextAttemptAt: Date.now() - 1 } });
    await deliverDue();
    d = (await c.connectorDeliveries.findOne({}))!;
    expect(d).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(received).toHaveLength(2);
    expect(received[1].headers["x-cp-delivery"]).toBe(uuid); // the same delivery id across retries
    expect(received[1].headers["x-cp-signature"]).not.toBe("");
    expect(JSON.parse(received[0].body).id).toBe(JSON.parse(received[1].body).id); // the same event, deduplicated by id
  });

  it("gives up after the last retry and records why", async () => {
    const { token } = await connected();
    await register(token);
    respond = () => ({ status: 503 });
    await act(token, "boards.create", { title: "Hopeless" });
    await fanOut();
    const c = await getCollections();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await c.connectorDeliveries.updateOne({}, { $set: { nextAttemptAt: Date.now() - 1 }, $unset: { leaseUntil: "" } });
      await deliverDue();
    }
    const d = (await c.connectorDeliveries.findOne({}))!;
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, lastStatusCode: 503 });
    expect(received).toHaveLength(MAX_ATTEMPTS);
  }, 30_000);

  it("disables the endpoint at once on 410 Gone and stops sending", async () => {
    const { token } = await connected();
    const hook = await register(token);
    respond = () => ({ status: 410 });
    await act(token, "boards.create", { title: "One" });
    await act(token, "boards.create", { title: "Two" });
    await pump();
    const got = await (await hookGet(req("/x", { headers: bearer(token) }), hookParams(hook.body.id))).json();
    expect(got).toMatchObject({ status: "disabled", disabledReason: expect.stringContaining("410") });
    expect(received.length).toBe(1); // the second event's delivery was cancelled, not attempted
    const c = await getCollections();
    expect((await c.connectorDeliveries.find({}).toArray()).every((d) => d.status === "failed")).toBe(true);
    await act(token, "boards.create", { title: "Three" });
    await pump();
    expect(received.length).toBe(1);
  });

  it("disables an endpoint after 50 consecutive failures or three days of failures, and a PATCH revives it", async () => {
    const { token } = await connected();
    const hook = await register(token);
    const c = await getCollections();
    respond = () => ({ status: 500 });
    await c.connectorWebhooks.updateOne({ _id: hook.body.id }, { $set: { consecutiveFailures: 49 } });
    await act(token, "boards.create", { title: "Fiftieth" });
    await pump();
    expect((await c.connectorWebhooks.findOne({ _id: hook.body.id }))).toMatchObject({ status: "disabled", disabledReason: expect.stringContaining("50") });

    await hookPatch(req("/x", { method: "PATCH", headers: bearer(token), body: { status: "active" } }), hookParams(hook.body.id));
    expect(await c.connectorWebhooks.findOne({ _id: hook.body.id })).toMatchObject({ status: "active", consecutiveFailures: 0 });
    await c.connectorWebhooks.updateOne({ _id: hook.body.id }, { $set: { firstFailureAt: Date.now() - 4 * 86_400_000 } });
    await act(token, "boards.create", { title: "Too late" });
    await pump();
    expect((await c.connectorWebhooks.findOne({ _id: hook.body.id }))!.disabledReason).toContain("3 days");
  });

  it("never follows a redirect and re-checks the address at delivery time", async () => {
    const { token } = await connected();
    const hook = await register(token);
    respond = () => ({ status: 302 });
    await act(token, "boards.create", { title: "Redirect" });
    await pump();
    const c = await getCollections();
    expect((await c.connectorDeliveries.findOne({}))).toMatchObject({ status: "pending", lastStatusCode: 302 }); // a failure, not followed

    // the name now points somewhere private (rules for production): the attempt is refused without any request
    await c.connectorWebhooks.updateOne({ _id: hook.body.id }, { $set: { url: "https://10.0.0.7/hook" } });
    delete process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS;
    try {
      const d = (await c.connectorDeliveries.findOne({}))!;
      const after = await attemptDelivery(d);
      expect(after.lastError).toMatch(/Blocked/);
    } finally {
      process.env.CONNECTOR_ALLOW_PRIVATE_WEBHOOKS = "true";
    }
    expect(received).toHaveLength(1);
  });

  it("lists the delivery log and replays a delivery on request", async () => {
    const { token } = await connected();
    const hook = await register(token);
    await act(token, "boards.create", { title: "Logged" });
    await pump();
    const log = await (await deliveriesRoute(req("/x", { headers: bearer(token) }), hookParams(hook.body.id))).json();
    expect(log.items).toHaveLength(1);
    expect(log.items[0]).toMatchObject({ status: "succeeded", attempts: 1, eventType: "board.created", lastStatusCode: 200 });

    const again = await redeliverRoute(req("/x", { method: "POST", headers: bearer(token) }), hookParams(hook.body.id, { deliveryId: log.items[0].id }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(received).toHaveLength(2);
    expect(received[1].headers["x-cp-delivery"]).not.toBe(received[0].headers["x-cp-delivery"]);
    expect(JSON.parse(received[1].body).id).toBe(JSON.parse(received[0].body).id);
    expect((await redeliverRoute(req("/x", { method: "POST", headers: bearer(token) }), hookParams(hook.body.id, { deliveryId: "nope" }))).status).toBe(404);
  });
});

describe("event log: GET /events (C20)", () => {
  async function replay(token: string, qs = "") {
    const res = await eventsRoute(req(`/api/connect/v1/events${qs}`, { headers: bearer(token) }));
    return { res, body: (await res.json()) as Json };
  }

  it("returns in order the same events the webhooks delivered, and pages by cursor", async () => {
    const { token, slateId } = await connected();
    await register(token);
    await act(token, "boards.create", { title: "One" });
    await act(token, "boards.setStatus", { boardId: slateId, status: "in_review" });
    await act(token, "boards.setSharing", { boardId: slateId, linkAccess: "view" });
    await pump();

    const delivered = received.map((r) => JSON.parse(r.body).id as string);
    const all = await replay(token);
    expect(all.res.status).toBe(200);
    expect(all.body.items.map((e: Json) => e.id)).toEqual(delivered);
    expect(all.body.items.map((e: Json) => e.type)).toEqual(["board.created", "board.status_changed", "board.shared"]);
    expect(all.body.items[0]).toMatchObject({ apiVersion: "cp1", service: "slate", data: { board: { title: "One" } } });

    const first = await replay(token, "?limit=2");
    expect(first.body.items).toHaveLength(2);
    const rest = await replay(token, `?limit=2&cursor=${first.body.nextCursor}`);
    expect(rest.body.items.map((e: Json) => e.id)).toEqual([delivered[2]]);
    const end = await replay(token, `?cursor=${rest.body.nextCursor}`);
    expect(end.body).toEqual({ items: [], nextCursor: null });

    const filtered = await replay(token, "?types=board.shared,board.created");
    expect(filtered.body.items.map((e: Json) => e.type)).toEqual(["board.created", "board.shared"]);
    expect((await replay(token, "?types=board.nope")).res.status).toBe(400);
    expect((await replay(token, "?cursor=garbage")).res.status).toBe(400);
  });

  it("needs the events scope, hides events the grant may not read and other workspaces' events", async () => {
    const { token, workspaceId } = await connected();
    await act(token, "boards.create", { title: "Mine" });
    const noEvents = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: ["slate:boards:read"] });
    expect((await replay(noEvents.accessToken)).res.status).toBe(403);

    const board = (await (await getCollections()).slates.findOne({ workspaceId }))!._id;
    await as(OWNER).mutation(api.comments.createThread, { slateId: board, anchor: { kind: "point", x: 0, y: 0 }, body: "private talk", mentions: [] });
    const readsEvents = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: ["slate:boards:read", "slate:events:read"] });
    const types = (await replay(readsEvents.accessToken)).body.items.map((e: Json) => e.type);
    expect(types).toContain("board.created");
    expect(types).not.toContain("comment.created"); // needs comments:read
    expect((await replay(token)).body.items.map((e: Json) => e.type)).toContain("comment.created");

    // a second workspace has a log of its own
    const c = await getCollections();
    const otherWs = (await c.workspaces.insertOne({ _id: "ws_other", name: "Other", ownerId: VIEWER.subject, createdAt: 1, updatedAt: 1 })).insertedId;
    await c.workspaceMembers.insertOne({ _id: "m_other", workspaceId: otherWs, userId: VIEWER.subject, role: "Admin", addedAt: 1 });
    const stranger = await makeGrant({ userId: VIEWER.subject, workspaceId: otherWs, scopes: HOOKS });
    expect((await replay(stranger.accessToken)).body.items).toEqual([]);
  });
});

describe("what produces events", () => {
  it("emits board.updated once a minute per board, not per edit, and comment.created for threads and replies", async () => {
    const { token, workspaceId, slateId } = await connected();
    const c = await getCollections();
    await c.slates.updateOne({ _id: slateId }, { $set: { lastEdited: 1 } }); // quiet for a long time: the next edit "touches" the board
    const put = (id: string) => ({ t: "put" as const, id, z: 1, data: JSON.stringify({ id, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, z: 1 }) });
    const editor = as(EDITOR);
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a")] });
    await editor.deferred.flush();
    await c.slates.updateOne({ _id: slateId }, { $set: { lastEdited: 1 } });
    await editor.mutation(api.elements.apply, { slateId, ops: [put("b")] });
    await editor.deferred.flush();
    expect(await c.connectorEvents.countDocuments({ workspaceId, type: "board.updated" })).toBe(1); // coalesced

    const thread = await as(OWNER).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: 5, y: 5 }, body: "First", mentions: [] });
    await as(VIEWER).mutation(api.comments.reply, { threadId: thread, body: "Second", mentions: [] });
    const comments = await c.connectorEvents.find({ workspaceId, type: "comment.created" }).sort({ cursor: 1 }).toArray();
    expect(comments.map((e) => (e.data as Json).comment.body)).toEqual(["First", "Second"]);
    expect(comments[1].data).toMatchObject({ board: { id: slateId }, comment: { authorName: "Vic Viewer" } });
    void token;
  });

  it("does nothing for any of it when no app is connected", async () => {
    const { workspaceId, slateId } = await setup();
    const c = await getCollections();
    await c.slates.updateOne({ _id: slateId }, { $set: { lastEdited: 1 } });
    const editor = as(EDITOR);
    await editor.mutation(api.elements.apply, { slateId, ops: [{ t: "put", id: "a", z: 1, data: "{}" }] });
    await editor.deferred.flush();
    await as(OWNER).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: 1, y: 1 }, body: "x", mentions: [] });
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(0);
    expect(await c.connectorCounters.countDocuments({})).toBe(0);
  });

  it("runs the whole dispatcher pass: fan out, deliver, sweep", async () => {
    const { token } = await connected();
    await register(token);
    await act(token, "boards.create", { title: "Pass" });
    expect(await runDispatcherOnce()).toMatchObject({ fanned: 1, delivered: 1 });
    expect(received).toHaveLength(1);
    expect(await runDispatcherOnce()).toMatchObject({ fanned: 0, delivered: 0 });
  });
});
