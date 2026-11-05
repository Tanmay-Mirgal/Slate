import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as unknownRoute, POST as unknownPost } from "@/app/api/connect/v1/[...path]/route";
import { api } from "@/lib/client/api";
import { graphToDsl, parseDsl } from "@/lib/diagram/dsl";
import { layoutGraph } from "@/lib/diagram/layout";
import { registry } from "@/lib/connector/registry";
import { buildManifest } from "@/lib/connector/registry/manifest";
import type { Scope } from "@/lib/connector/scopes";
import { getCollections, newDocId } from "@/lib/db/mongo";
import { bearer, disableConnector, enableConnector, makeGrant, req, seedUsers } from "./helpers/connector";
import { as, EDITOR, OWNER, resetDb, setup, startDb, stopDb, STRANGER, VIEWER } from "./helpers/db";

beforeAll(async () => {
  enableConnector();
  await startDb();
});
afterAll(async () => {
  await stopDb();
  disableConnector();
});
beforeEach(async () => {
  await resetDb();
  await seedUsers();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const READ: Scope[] = ["slate:workspaces:read", "slate:boards:read", "slate:comments:read"];

async function get(path: string, token: string, extraHeaders: Record<string, string> = {}) {
  const pathname = path.split("?")[0];
  const res = await unknownRoute(req(`/api/connect/v1${path}`, { headers: bearer(token, extraHeaders) }), { params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }) });
  return { res, body: (await res.json()) as Json };
}

/** Every resource response must conform to the schema the manifest advertises for it. */
function conforms(name: string, body: unknown) {
  const resource = registry.resources.find((r) => r.name === name)!;
  const parsed = resource.output.safeParse(body);
  expect(parsed.success, `${name}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
}

/** A second tenant: another owner, another workspace, a board of its own. */
async function secondWorkspace() {
  const c = await getCollections();
  const workspaceId = newDocId();
  await c.workspaces.insertOne({ _id: workspaceId, name: "Other company", ownerId: STRANGER.subject, createdAt: 1, updatedAt: 1 });
  await c.workspaceMembers.insertOne({ _id: newDocId(), workspaceId, userId: STRANGER.subject, role: "Admin", addedAt: 1 });
  const slateId = newDocId();
  await c.slates.insertOne({ _id: slateId, title: "Secret roadmap", workspaceId, isArchived: false, createdAt: 5, lastEdited: 5, thumbnailIcon: "1", linkAccess: "none", schemaVersion: 2, elementSeq: 0 });
  return { workspaceId, slateId };
}

async function addBoard(workspaceId: string, title: string, lastEdited: number, extra: Record<string, unknown> = {}) {
  const c = await getCollections();
  const id = newDocId();
  await c.slates.insertOne({ _id: id, title, workspaceId, isArchived: false, createdAt: lastEdited, lastEdited, thumbnailIcon: "2", linkAccess: "none", schemaVersion: 2, elementSeq: 0, ...extra });
  return id;
}

async function draw(slateId: string, dsl: string) {
  const { graph } = parseDsl(dsl);
  const layout = await layoutGraph(graph);
  await as(EDITOR).mutation(api.elements.apply, { slateId, ops: layout.elements.map((el) => ({ t: "put" as const, id: el.id, z: el.z, data: JSON.stringify(el) })) });
  return layout;
}

const DSL = `title Orders
type architecture

Web [subtitle: "Next.js"]
API [subtitle: "REST"]
DB [subtitle: "Postgres"]

Web > API : HTTPS
API > DB : SQL
`;

describe("workspaces", () => {
  it("returns the pinned workspace with the caller's role, and nothing else", async () => {
    const { workspaceId } = await setup();
    await secondWorkspace();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const { res, body } = await get("/workspaces", g.accessToken);
    expect(res.status).toBe(200);
    expect(body.items).toEqual([expect.objectContaining({ id: workspaceId, name: "WS", kind: "workspace", role: "Editor", memberCount: 3 })]);
    expect(body.nextCursor).toBeNull();
    conforms("workspaces.list", body);
  });

  it("needs its own scope", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: ["slate:boards:read"] });
    const { res, body } = await get("/workspaces", g.accessToken);
    expect(res.status).toBe(403);
    expect(body.error).toMatchObject({ code: "insufficient_scope", requiredScope: "slate:workspaces:read" });
  });
});

describe("boards: list", () => {
  it("lists only this workspace's active boards, newest edit first, in the board shape (C08)", async () => {
    const { workspaceId, slateId } = await setup();
    const other = await secondWorkspace();
    const c = await getCollections();
    const newer = await addBoard(workspaceId, "Newer board", Date.now() + 1000, { status: "approved", statusChangedAt: 123, statusChangedBy: OWNER.subject, metadata: { ticket: "ENG-1" }, externalRef: { hubRunId: "run_9" }, createdVia: "connector" });
    const archived = await addBoard(workspaceId, "Gone", Date.now() + 2000);
    await c.slates.updateOne({ _id: archived }, { $set: { isArchived: true } });
    await c.slateStats.insertOne({ _id: newDocId(), slateId: newer, nodes: 4, connectors: 3, updatedAt: 1 });

    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const { res, body } = await get("/boards", g.accessToken);
    expect(res.status).toBe(200);
    expect(body.items.map((b: Json) => b.id)).toEqual([newer, slateId]);
    expect(body.items[0]).toMatchObject({
      title: "Newer board",
      status: "approved",
      stats: { nodes: 4, connectors: 3 },
      createdVia: "connector",
      metadata: { ticket: "ENG-1" },
      externalRef: { hubRunId: "run_9" },
      statusChangedBy: { id: OWNER.subject, name: "Owner One" },
      webUrl: `https://slate.test/canvas/${newer}`,
    });
    expect(body.items[1]).toMatchObject({ status: "draft", stats: null, createdVia: "ui", linkAccess: "none" });
    conforms("boards.list", body);

    // the other tenant sees its own board and none of ours
    const stranger = await makeGrant({ userId: STRANGER.subject, workspaceId: other.workspaceId, scopes: READ });
    const theirs = await get("/boards", stranger.accessToken);
    expect(theirs.body.items.map((b: Json) => b.id)).toEqual([other.slateId]);
  });

  it("pages with opaque cursors that stay stable while boards are added (C12)", async () => {
    const { workspaceId } = await setup();
    const base = Date.now() - 100_000;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await addBoard(workspaceId, `Board ${i}`, base + i * 1000)); // plus the one from setup()
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });

    const first = await get("/boards?limit=3", g.accessToken);
    expect(first.body.items).toHaveLength(3);
    expect(typeof first.body.nextCursor).toBe("string");
    expect(first.body.nextCursor).not.toMatch(/[{}"]/); // opaque

    // somebody creates a brand new board between two page requests: the next page must not shift
    const interloper = await addBoard(workspaceId, "Arrived later", Date.now() + 5000);
    const second = await get(`/boards?limit=3&cursor=${first.body.nextCursor}`, g.accessToken);
    const third = await get(`/boards?limit=3&cursor=${second.body.nextCursor}`, g.accessToken);

    const seen = [...first.body.items, ...second.body.items, ...third.body.items].map((b: Json) => b.id);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen).not.toContain(interloper); // it is newer than the cursor, so it is not part of this walk
    expect(seen).toHaveLength(7);
    expect(third.body.nextCursor).toBeNull();
    for (const id of ids) expect(seen).toContain(id);
  });

  it("filters by title, status and update time, and treats search text literally", async () => {
    const { workspaceId } = await setup();
    const t = Date.now();
    await addBoard(workspaceId, "Payments (v2) design", t - 5000, { status: "in_review" });
    await addBoard(workspaceId, "payments legacy", t - 4000, { status: "approved" });
    await addBoard(workspaceId, "Search service", t - 3000);
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });

    const titles = async (qs: string) => (await get(`/boards${qs}`, g.accessToken)).body.items.map((b: Json) => b.title).sort();
    expect(await titles("?query=PAYMENTS")).toEqual(["Payments (v2) design", "payments legacy"]);
    expect(await titles("?query=(v2)")).toEqual(["Payments (v2) design"]); // parentheses are not regex syntax
    expect(await titles("?query=.*")).toEqual([]);
    expect(await titles("?status=approved")).toEqual(["payments legacy"]);
    expect(await titles("?status=in_review")).toEqual(["Payments (v2) design"]);
    expect(await titles("?status=draft")).toEqual(["Board", "Search service"]); // no status yet means draft
    expect(await titles(`?updatedSince=${new Date(t - 3500).toISOString()}`)).toEqual(["Search service"]);
  });

  it("rejects bad paging and unknown parameters in the error shape, unless told to ignore the latter", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    for (const qs of ["?limit=0", "?limit=201", "?limit=abc", "?cursor=not-a-cursor", "?status=bogus", "?updatedSince=yesterday", "?surprise=1", "?limit=5&limit=6"]) {
      const { res, body } = await get(`/boards${qs}`, g.accessToken);
      expect(res.status, qs).toBe(400);
      expect(body.error.code, qs).toBe("validation_failed");
    }
    expect((await get("/boards?limit=200", g.accessToken)).res.status).toBe(200);
    expect((await get("/boards?surprise=1", g.accessToken, { prefer: "unknown-fields=ignore" })).res.status).toBe(200);
  });
});

describe("boards: one board and its parts", () => {
  it("returns the board, document, DSL and graph", async () => {
    const { workspaceId, slateId } = await setup();
    await draw(slateId, DSL);
    const c = await getCollections();
    await c.slates.updateOne({ _id: slateId }, { $set: { documentText: "# Orders\n\nThe **orders** platform.\n\n- one\n- two", metadata: { x: 1 } } });
    const g = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: READ });

    const board = await get(`/boards/${slateId}`, g.accessToken);
    expect(board.res.status).toBe(200);
    expect(board.body).toMatchObject({ id: slateId, title: "Board", status: "draft", metadata: { x: 1 } });
    conforms("boards.get", board.body);

    const doc = await get(`/boards/${slateId}/document`, g.accessToken);
    expect(doc.body.markdown).toContain("The **orders** platform.");
    expect(doc.body.text).toContain("The orders platform.");
    expect(doc.body.text).not.toContain("**");
    expect(doc.body.bytes).toBeGreaterThan(10);
    conforms("boards.document", doc.body);

    const dsl = await get(`/boards/${slateId}/dsl`, g.accessToken);
    expect(dsl.body).toMatchObject({ kind: "architecture", nodes: 3, edges: 2 });
    for (const label of ["Web", "API", "DB"]) expect(dsl.body.dsl).toContain(label);
    expect(parseDsl(dsl.body.dsl).errors).toEqual([]); // it round-trips
    conforms("boards.dsl", dsl.body);

    const graph = await get(`/boards/${slateId}/graph`, g.accessToken);
    expect(graph.body.nodes.map((n: Json) => n.label).sort()).toEqual(["API", "DB", "Web"]);
    expect(graph.body.edges).toHaveLength(2);
    expect(graph.body.edges.find((e: Json) => e.label === "SQL")).toBeDefined();
    conforms("boards.graph", graph.body);
    expect(graphToDsl(graph.body as Parameters<typeof graphToDsl>[0])).toContain("API");
  });

  it("derives the plain text from the editor's own document when there is one", async () => {
    const { workspaceId, slateId } = await setup();
    const c = await getCollections();
    const json = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }, { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "bold" }] }] }] };
    await c.slates.updateOne({ _id: slateId }, { $set: { documentText: "# Title\n\nHello **world**", documentJson: JSON.stringify(json) } });
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    expect((await get(`/boards/${slateId}/document`, g.accessToken)).body.text).toBe("Title\nHello world");
  });

  it("answers empty documents and empty boards without failing", async () => {
    const { workspaceId, slateId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    expect((await get(`/boards/${slateId}/document`, g.accessToken)).body).toMatchObject({ markdown: "", text: "", bytes: 0 });
    expect((await get(`/boards/${slateId}/dsl`, g.accessToken)).body).toMatchObject({ dsl: "", nodes: 0 });
    expect((await get(`/boards/${slateId}/graph`, g.accessToken)).body).toMatchObject({ nodes: [], edges: [] });
  });
});

describe("tenant isolation (C08)", () => {
  it("answers 404, never 403, for another workspace's board on every endpoint, exactly as for an id that does not exist", async () => {
    const { workspaceId } = await setup();
    const other = await secondWorkspace();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });

    for (const suffix of ["", "/document", "/dsl", "/graph", "/comments"]) {
      const foreign = await get(`/boards/${other.slateId}${suffix}`, g.accessToken);
      const missing = await get(`/boards/${newDocId()}${suffix}`, g.accessToken);
      expect(foreign.res.status, suffix).toBe(404);
      expect(missing.res.status, suffix).toBe(404);
      expect(foreign.body.error.code).toBe("not_found");
      // the two responses cannot be told apart, so ids cannot be probed
      expect({ ...foreign.body.error, requestId: "" }).toEqual({ ...missing.body.error, requestId: "" });
    }
    // and the other tenant's grant is just as blind to ours
    const stranger = await makeGrant({ userId: STRANGER.subject, workspaceId: other.workspaceId, scopes: READ });
    const { slateId } = await (async () => {
      const c = await getCollections();
      return { slateId: (await c.slates.findOne({ workspaceId }))!._id };
    })();
    expect((await get(`/boards/${slateId}`, stranger.accessToken)).res.status).toBe(404);
  });

  it("hides archived boards and weird ids the same way", async () => {
    const { workspaceId } = await setup();
    const gone = await addBoard(workspaceId, "Gone", Date.now());
    const c = await getCollections();
    await c.slates.updateOne({ _id: gone }, { $set: { isArchived: true } });
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    expect((await get(`/boards/${gone}`, g.accessToken)).res.status).toBe(404);
    for (const id of ["x".repeat(500), "%24ne", "..", "a%2Fb"]) expect((await get(`/boards/${id}`, g.accessToken)).res.status, id).toBe(404);
  });

  it("scopes a grant to its own workspace even if the user belongs to several", async () => {
    const { workspaceId } = await setup();
    const other = await secondWorkspace();
    const c = await getCollections();
    await c.workspaceMembers.insertOne({ _id: newDocId(), workspaceId: other.workspaceId, userId: OWNER.subject, role: "Admin", addedAt: 2 }); // OWNER can open both in the app
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    expect((await get(`/boards/${other.slateId}`, g.accessToken)).res.status).toBe(404);
    expect((await get("/boards", g.accessToken)).body.items.map((b: Json) => b.title)).toEqual(["Board"]);
  });
});

describe("roles apply to reads too (C09)", () => {
  it("keeps reading after a downgrade to Viewer and stops when the user is removed", async () => {
    const { workspaceId, slateId } = await setup();
    const g = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: READ });
    const c = await getCollections();
    await c.workspaceMembers.updateOne({ workspaceId, userId: EDITOR.subject }, { $set: { role: "Viewer" } });
    expect((await get(`/boards/${slateId}`, g.accessToken)).res.status).toBe(200);
    await c.workspaceMembers.deleteOne({ workspaceId, userId: EDITOR.subject });
    const denied = await get(`/boards/${slateId}`, g.accessToken);
    expect(denied.res.status).toBe(403);
    expect(denied.body.error.code).toBe("forbidden");
  });
});

describe("comments", () => {
  it("lists threads with their messages, filters by status and pages", async () => {
    const { workspaceId, slateId } = await setup();
    const t1 = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: 10, y: 20 }, body: "Why Postgres?", mentions: [] });
    await as(OWNER).mutation(api.comments.reply, { threadId: t1, body: "Team knows it", mentions: [] });
    const t2 = await as(OWNER).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: 1, y: 2 }, body: "Add a cache", mentions: [] });
    await as(OWNER).mutation(api.comments.setResolved, { threadId: t2, resolved: true });
    const g = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: READ });

    const all = await get(`/boards/${slateId}/comments`, g.accessToken);
    expect(all.res.status).toBe(200);
    expect(all.body.items).toHaveLength(2);
    const thread = all.body.items.find((t: Json) => t.id === t1);
    expect(thread).toMatchObject({ status: "open", replyCount: 1, author: { id: EDITOR.subject, name: "Edie Editor" }, anchor: { kind: "point", x: 10, y: 20 } });
    expect(thread.messages.map((m: Json) => m.body)).toEqual(["Why Postgres?", "Team knows it"]);
    conforms("boards.comments", all.body);

    expect((await get(`/boards/${slateId}/comments?status=resolved`, g.accessToken)).body.items.map((t: Json) => t.id)).toEqual([t2]);
    const page = await get(`/boards/${slateId}/comments?limit=1`, g.accessToken);
    expect(page.body.items).toHaveLength(1);
    const next = await get(`/boards/${slateId}/comments?limit=1&cursor=${page.body.nextCursor}`, g.accessToken);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    expect(next.body.nextCursor).toBeNull();
  });

  it("is a separate scope", async () => {
    const { workspaceId, slateId } = await setup();
    const g = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: ["slate:boards:read"] });
    const { res, body } = await get(`/boards/${slateId}/comments`, g.accessToken);
    expect(res.status).toBe(403);
    expect(body.error.requiredScope).toBe("slate:comments:read");
  });
});

describe("templates", () => {
  it("lists the built-in templates with a kind and pages through them", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: READ });
    const all = await get("/templates?limit=200", g.accessToken);
    expect(all.res.status).toBe(200);
    const ids = all.body.items.map((t: Json) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["aws-microservices", "database-erd", "system-design-interview", "microservices-ecommerce", "login-flowchart"]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.body.items.find((t: Json) => t.id === "database-erd").kind).toBe("erd");
    expect(all.body.items.find((t: Json) => t.id === "system-design-interview").kind).toBe("interview");
    conforms("templates.list", all.body);

    const p1 = await get("/templates?limit=4", g.accessToken);
    const p2 = await get(`/templates?limit=4&cursor=${p1.body.nextCursor}`, g.accessToken);
    expect(p1.body.items).toHaveLength(4);
    expect(p2.body.items.map((t: Json) => t.id)).toEqual(ids.slice(4, 8));
  });
});

describe("routing", () => {
  it("serves every registered resource and is advertised in the manifest", async () => {
    const manifest = buildManifest(registry, { baseUrl: "https://slate.test" });
    expect(manifest.resources.map((r) => r.path).sort()).toEqual(["/boards", "/boards/{id}", "/boards/{id}/comments", "/boards/{id}/document", "/boards/{id}/dsl", "/boards/{id}/graph", "/templates", "/workspaces"]);
    for (const r of manifest.resources) expect(r.method).toBe("GET");
  });

  it("answers JSON 404 for unknown paths and for writes to a read-only resource, with or without a token", async () => {
    const { workspaceId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    expect((await get("/nope", g.accessToken)).res.status).toBe(404);
    expect((await get("/boards/a/b/c", g.accessToken)).res.status).toBe(404);
    const post = await unknownPost(req("/api/connect/v1/boards", { method: "POST", headers: bearer(g.accessToken), body: { title: "x" } }), { params: Promise.resolve({ path: ["boards"] }) });
    expect(post.status).toBe(404);
    expect((await post.json()).error.code).toBe("not_found");
    const anon = await unknownRoute(req("/api/connect/v1/boards"), { params: Promise.resolve({ path: ["boards"] }) });
    expect(anon.status).toBe(401);
  });

  it("counts reads against the audit log without storing what was read", async () => {
    const { workspaceId, slateId } = await setup();
    const g = await makeGrant({ userId: OWNER.subject, workspaceId, scopes: READ });
    await get(`/boards/${slateId}`, g.accessToken);
    const c = await getCollections();
    const rows = await c.connectorAudit.find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: "/boards/{id}", method: "GET", status: 200 });
    expect(JSON.stringify(rows)).not.toContain(slateId);
  });
});
