import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GET as healthRoute } from "@/app/api/connect/v1/health/route";
import { GET as manifestRoute } from "@/app/api/connect/v1/manifest/route";
import { GET as wellKnownRoute } from "@/app/.well-known/ecosystem-connector.json/route";
import { GET as openapiRoute } from "@/app/api/connect/v1/openapi.json/route";
import { GET as unknownRoute } from "@/app/api/connect/v1/[...path]/route";
import { settleDeferred } from "@/lib/connector/defer";
import { ok, tokenRoute } from "@/lib/connector/http";
import { manifestSchema } from "@/lib/connector/registry/manifest";
import { getCollections } from "@/lib/db/mongo";
import { bearer, disableConnector, enableConnector, HUB, makeGrant, req } from "./helpers/connector";
import { EDITOR, OWNER, resetDb, setup, startDb, stopDb, VIEWER } from "./helpers/db";

beforeAll(async () => {
  enableConnector();
  await startDb(); // after the flag is on, so the connector indexes are built
});
afterAll(async () => {
  await stopDb();
  disableConnector();
});
beforeEach(resetDb);

let runs = 0;
beforeEach(() => {
  runs = 0;
});

const readRoute = tokenRoute({ route: "/t/read", scopes: ["slate:boards:read"] }, async (c) => ok({ userId: c.grant.userId, role: c.grant.role, workspaceId: c.grant.workspaceId }));
const writeRoute = tokenRoute({ route: "/t/write", scopes: ["slate:boards:write"], idempotent: true }, async (c) => {
  const input = c.parse(z.strictObject({ n: z.number(), label: z.string().optional() }), await c.json());
  c.audit("test.write");
  runs++;
  return ok({ n: input.n, runs }, 201);
});
const anyRoute = tokenRoute({ route: "/t/any" }, async () => ok({ fine: true }));
const boomRoute = tokenRoute({ route: "/t/boom" }, async () => {
  throw new Error("mongodb://admin:hunter2@cluster exploded");
});

const READ = ["slate:boards:read"] as const;
const WRITE = ["slate:boards:read", "slate:boards:write"] as const;

async function body(res: Response) {
  return (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("public endpoints", () => {
  it("serves the manifest at the well-known URL and under /api, cacheable for five minutes", async () => {
    for (const handler of [wellKnownRoute, manifestRoute]) {
      const res = await handler(req("/x"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(manifestSchema.safeParse(await res.json()).success).toBe(true);
    }
    const a = await (await wellKnownRoute(req("/x"))).json();
    const b = await (await manifestRoute(req("/x"))).json();
    expect(a).toEqual(b);
    expect(a.baseUrl).toBe("https://slate.test");
  });

  it("answers health without a token and without secrets", async () => {
    const res = await healthRoute(req("/api/connect/v1/health"));
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json).toEqual({ status: "ok", version: "1.0.0", time: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
  });

  it("serves OpenAPI 3.1", async () => {
    const json = await body(await openapiRoute(req("/x")));
    expect(json.openapi).toBe("3.1.0");
    expect(json.components.securitySchemes.bearer).toBeDefined();
  });

  it("returns JSON, never HTML, for a path nobody owns", async () => {
    const res = await unknownRoute(req("/api/connect/v1/nope"), { params: Promise.resolve({ path: ["nope"] }) });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await body(res)).error.code).toBe("not_found");
  });
});

describe("authentication (2.4.1)", () => {
  it("rejects a missing, malformed, unknown, expired, revoked or foreign-client token with 401 in the error shape", async () => {
    const { workspaceId } = await setup();
    const good = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const expired = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ, accessExpired: true });
    const revoked = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ, revoked: true });
    const foreign = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ, clientId: "someone_else" });

    const attempts: Record<string, Record<string, string>> = {
      "no header": {},
      "wrong scheme": { authorization: `Basic ${good.accessToken}` },
      "empty bearer": { authorization: "Bearer " },
      "unknown token": bearer("cp1_slate_" + "x".repeat(43)),
      "token without the access prefix": bearer("not-a-slate-token"),
      "a refresh token used as access token": bearer(good.refreshToken),
      expired: bearer(expired.accessToken),
      revoked: bearer(revoked.accessToken),
      "grant of another client": bearer(foreign.accessToken),
    };
    for (const [name, headers] of Object.entries(attempts)) {
      const res = await readRoute(req("/t/read", { headers }));
      expect(res.status, name).toBe(401);
      expect(res.headers.get("www-authenticate"), name).toContain("Bearer");
      const json = await body(res);
      expect(json.error, name).toMatchObject({ code: "unauthorized", retryable: false });
      expect(json.error.requestId, name).toBe(res.headers.get("x-request-id"));
    }

    expect((await readRoute(req("/t/read", { headers: bearer(good.accessToken) }))).status).toBe(200);
  });

  it("revoking a grant blocks the very next call", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    expect((await readRoute(req("/t/read", { headers: bearer(g.accessToken) }))).status).toBe(200);
    const c = await getCollections();
    await c.connectorGrants.updateOne({ _id: g.grantId }, { $set: { revokedAt: Date.now() } });
    expect((await readRoute(req("/t/read", { headers: bearer(g.accessToken) }))).status).toBe(401);
  });

  it("stores no raw token and enforces unique hashes", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const c = await getCollections();
    const row = await c.connectorGrants.findOne({ _id: g.grantId });
    expect(JSON.stringify(row)).not.toContain(g.accessToken);
    expect(JSON.stringify(row)).not.toContain(g.refreshToken);
    await expect(c.connectorGrants.insertOne({ ...row!, _id: "dup" })).rejects.toMatchObject({ code: 11000 });
  });
});

describe("scopes and the user's live role (2.4.2, 2.4.3)", () => {
  it("answers 403 insufficient_scope with the scope that is missing", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const res = await writeRoute(req("/t/write", { headers: bearer(g.accessToken), body: { n: 1 } }));
    expect(res.status).toBe(403);
    expect((await body(res)).error).toMatchObject({ code: "insufficient_scope", requiredScope: "slate:boards:write" });
    expect(runs).toBe(0);
  });

  it("runs as the consenting user with the role they hold now", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    expect(await body(await readRoute(req("/t/read", { headers: bearer(g.accessToken) })))).toEqual({ userId: EDITOR.subject, role: "Editor", workspaceId });
  });

  it("applies a role downgrade on the next call (C09)", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: WRITE });
    const call = () => writeRoute(req("/t/write", { headers: bearer(g.accessToken), body: { n: 1 } }));
    expect((await call()).status).toBe(201);

    const c = await getCollections();
    await c.workspaceMembers.updateOne({ workspaceId, userId: EDITOR.subject }, { $set: { role: "Viewer" } });
    const denied = await call();
    expect(denied.status).toBe(403);
    expect((await body(denied)).error.code).toBe("forbidden"); // the scope was granted; the role no longer allows it
    expect((await readRoute(req("/t/read", { headers: bearer(g.accessToken) }))).status).toBe(200); // reading still works

    await c.workspaceMembers.updateOne({ workspaceId, userId: EDITOR.subject }, { $set: { role: "Admin" } });
    expect((await call()).status).toBe(201); // and an upgrade is just as immediate
  });

  it("stops working when the user leaves the workspace", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: READ });
    const c = await getCollections();
    await c.workspaceMembers.deleteOne({ workspaceId, userId: VIEWER.subject });
    const res = await readRoute(req("/t/read", { headers: bearer(g.accessToken) }));
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe("forbidden");
  });

  it("lets a Viewer read but never write, whatever was granted", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: WRITE });
    expect((await readRoute(req("/t/read", { headers: bearer(g.accessToken) }))).status).toBe(200);
    expect((await writeRoute(req("/t/write", { headers: bearer(g.accessToken), body: { n: 1 } }))).status).toBe(403);
  });
});

describe("request conventions (3)", () => {
  it("echoes X-Request-Id, generates one otherwise, and sets no CORS headers", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    const given = await readRoute(req("/t/read", { headers: bearer(g.accessToken, { "x-request-id": "hub-trace-42" }) }));
    expect(given.headers.get("x-request-id")).toBe("hub-trace-42");
    const made = await readRoute(req("/t/read", { headers: bearer(g.accessToken, { "x-request-id": "bad id with spaces" }) }));
    expect(made.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{20}$/);
    for (const res of [given, made]) {
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
    }
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    const h = bearer(g.accessToken);
    const bad = await writeRoute(req("/t/write", { headers: h, rawBody: "{not json" }));
    expect(bad.status).toBe(400);
    expect((await body(bad)).error.code).toBe("validation_failed");

    const big = JSON.stringify({ n: 1, label: "x".repeat(1_048_576) });
    const stream = await writeRoute(req("/t/write", { headers: h, rawBody: big })); // no content-length: caught while reading
    expect(stream.status).toBe(413);
    const declared = await writeRoute(req("/t/write", { headers: { ...h, "content-length": "2000000" }, rawBody: "{}" }));
    expect(declared.status).toBe(413);
    expect(runs).toBe(0);
  });

  it("rejects unknown fields unless Prefer: unknown-fields=ignore is sent, and says where the problem is", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    const strict = await writeRoute(req("/t/write", { headers: bearer(g.accessToken), body: { n: 1, surprise: true } }));
    expect(strict.status).toBe(400);
    expect((await body(strict)).error).toMatchObject({ code: "validation_failed", details: [{ path: "", message: expect.stringContaining("surprise") }] });

    const lenient = await writeRoute(req("/t/write", { headers: bearer(g.accessToken, { prefer: "return=minimal, unknown-fields=ignore" }), body: { n: 1, surprise: true } }));
    expect(lenient.status).toBe(201);

    const wrongType = await writeRoute(req("/t/write", { headers: bearer(g.accessToken, { prefer: "unknown-fields=ignore" }), body: { n: "one" } }));
    expect(wrongType.status).toBe(400);
    expect((await body(wrongType)).error.details).toEqual([{ path: "n", message: expect.any(String) }]);
  });

  it("never leaks the message of an unexpected failure", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await boomRoute(req("/t/boom", { headers: bearer(g.accessToken, { "x-request-id": "boom-1" }) }));
    spy.mockRestore();
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error).toMatchObject({ code: "internal", retryable: true, requestId: "boom-1" });
  });
});

describe("rate limiting (C13)", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down in headers, then answers 429 with Retry-After; other grants are unaffected", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    const other = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const call = (token: string) => anyRoute(req("/t/any", { headers: bearer(token) }));

    const first = await call(g.accessToken);
    expect(first.headers.get("x-ratelimit-limit")).toBe("120");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("119");
    const reset = Number(first.headers.get("x-ratelimit-reset"));
    expect(reset).toBeGreaterThan(Date.now() / 1000);
    expect(reset).toBeLessThanOrEqual(Date.now() / 1000 + 61);

    const results: number[] = [];
    for (let i = 1; i < 120; i++) results.push((await call(g.accessToken)).status);
    expect(results.every((s) => s === 200)).toBe(true);

    const limited = await call(g.accessToken);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
    expect((await body(limited)).error).toMatchObject({ code: "rate_limited", retryable: true });

    expect((await call(other.accessToken)).status).toBe(200);
  }, 60_000);
});

describe("idempotency (C10)", () => {
  const post = (token: string, key: string | null, payload: unknown, extra: Record<string, string> = {}) =>
    writeRoute(req("/t/write", { headers: bearer(token, { ...(key ? { "idempotency-key": key } : {}), ...extra }), body: payload }));

  it("replays the stored response for the same key and body, even if the key order differs", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    const first = await post(g.accessToken, "key-1", { n: 1, label: "a" });
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotent-replay")).toBeNull();
    const firstBody = await body(first);

    const again = await post(g.accessToken, "key-1", { label: "a", n: 1 });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replay")).toBe("true");
    expect(await body(again)).toEqual(firstBody);
    expect(runs).toBe(1);
  });

  it("answers 422 idempotency_conflict when the key is reused with a different body", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    await post(g.accessToken, "key-2", { n: 1 });
    const res = await post(g.accessToken, "key-2", { n: 2 });
    expect(res.status).toBe(422);
    expect((await body(res)).error.code).toBe("idempotency_conflict");
    expect(runs).toBe(1);
  });

  it("scopes keys to the grant", async () => {
    const { workspaceId } = await setup();
    const a = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    const b = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: WRITE });
    expect((await post(a.accessToken, "shared", { n: 1 })).status).toBe(201);
    const res = await post(b.accessToken, "shared", { n: 2 });
    expect(res.status).toBe(201);
    expect(res.headers.get("idempotent-replay")).toBeNull();
    expect(runs).toBe(2);
  });

  it("runs a concurrent duplicate once: the other request gets 409 with Retry-After or the replay", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    const results = await Promise.all([post(g.accessToken, "race", { n: 1 }), post(g.accessToken, "race", { n: 1 }), post(g.accessToken, "race", { n: 1 })]);
    expect(runs).toBe(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
    const losers = results.filter((r) => r.status === 409);
    for (const r of losers) {
      expect(r.headers.get("retry-after")).toBe("1");
      expect((await body(r)).error.code).toBe("conflict");
    }
  });

  it("forgets a failed attempt so the same key can be retried", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    expect((await post(g.accessToken, "retry", { n: "bad" })).status).toBe(400);
    const res = await post(g.accessToken, "retry", { n: 5 });
    expect(res.status).toBe(201);
    expect(res.headers.get("idempotent-replay")).toBeNull();
  });

  it("validates the key and ignores requests without one", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: WRITE });
    expect((await post(g.accessToken, "k".repeat(129), { n: 1 })).status).toBe(400);
    expect((await post(g.accessToken, "k".repeat(128), { n: 1 })).status).toBe(201);
    await post(g.accessToken, null, { n: 1 });
    await post(g.accessToken, null, { n: 1 });
    expect(runs).toBe(3);
  });
});

describe("audit trail and bookkeeping", () => {
  it("records every authenticated call with the client, grant, route and request id, but no payload", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: WRITE });
    await readRoute(req("/t/read", { headers: bearer(g.accessToken, { "x-request-id": "audit-1" }) }));
    await writeRoute(req("/t/write", { headers: bearer(g.accessToken, { "x-request-id": "audit-2" }), body: { n: 1, label: "confidential board title" } }));
    await readRoute(req("/t/read", { headers: bearer("cp1_slate_" + "y".repeat(43)) })); // unauthenticated: nothing to attribute

    const c = await getCollections();
    const rows = await c.connectorAudit.find({}).sort({ at: 1 }).toArray();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ via: "connector", grantId: g.grantId, clientId: HUB.clientId, workspaceId, userId: EDITOR.subject, method: "GET", route: "/t/read", status: 200, requestId: "audit-1" });
    expect(rows[1]).toMatchObject({ method: "POST", route: "test.write", status: 201, requestId: "audit-2" });
    expect(JSON.stringify(rows)).not.toContain("confidential");
    expect(JSON.stringify(rows)).not.toContain(g.accessToken);
    expect(rows[0].expireAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
  });

  it("updates lastUsedAt at most once per five minutes", async () => {
    const { workspaceId } = await setup();
    const c = await getCollections();
    const fresh = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    await readRoute(req("/t/read", { headers: bearer(fresh.accessToken) }));
    await settleDeferred();
    const first = (await c.connectorGrants.findOne({ _id: fresh.grantId }))!.lastUsedAt;
    expect(first).toBeGreaterThan(Date.now() - 5000);

    await readRoute(req("/t/read", { headers: bearer(fresh.accessToken) }));
    await settleDeferred();
    expect((await c.connectorGrants.findOne({ _id: fresh.grantId }))!.lastUsedAt).toBe(first);

    const stale = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ, lastUsedAt: Date.now() - 6 * 60_000 });
    await readRoute(req("/t/read", { headers: bearer(stale.accessToken) }));
    await settleDeferred();
    expect((await c.connectorGrants.findOne({ _id: stale.grantId }))!.lastUsedAt).toBeGreaterThan(Date.now() - 5000);
  });

  it("builds the connector indexes, including TTLs, when the connector is on", async () => {
    const c = await getCollections();
    const ttl = async (name: string) => (await c.db.collection(name).indexes()).find((i) => i.key.expireAt === 1)?.expireAfterSeconds;
    for (const name of ["connector_codes", "connector_used_refresh", "connector_events", "connector_deliveries", "connector_operations", "connector_idempotency", "connector_audit", "connector_ratelimits"]) {
      expect(await ttl(name), name).toBe(0);
    }
    const uniques = (await c.connectorGrants.indexes()).filter((i) => i.unique).map((i) => Object.keys(i.key)[0]);
    expect(uniques).toEqual(expect.arrayContaining(["accessHash", "refreshHash"]));
    const eventIdx = await c.connectorEvents.indexes();
    expect(eventIdx.some((i) => i.unique && i.key.workspaceId === 1 && i.key.cursor === 1)).toBe(true);
  });
});
