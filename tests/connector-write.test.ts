import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as actionRoute } from "@/app/api/connect/v1/actions/[name]/route";
import { GET as readRoute } from "@/app/api/connect/v1/[...path]/route";
import { api } from "@/lib/client/api";
import { parseDsl } from "@/lib/diagram/dsl";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { Scope } from "@/lib/connector/scopes";
import { bearer, disableConnector, enableConnector, makeGrant, req, seedUsers } from "./helpers/connector";
import { as, EDITOR, OWNER, resetDb, setup, startDb, stopDb, VIEWER } from "./helpers/db";

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

const ALL: Scope[] = ["slate:workspaces:read", "slate:boards:read", "slate:boards:write", "slate:comments:read", "slate:events:read"];

async function act(token: string, name: string, input: unknown, headers: Record<string, string> = {}) {
  const res = await actionRoute(req(`/api/connect/v1/actions/${name}`, { headers: bearer(token, headers), body: { input } }), { params: Promise.resolve({ name }) });
  return { res, body: (await res.json()) as Json };
}

async function read(token: string, path: string) {
  const res = await readRoute(req(`/api/connect/v1${path}`, { headers: bearer(token) }), { params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }) });
  return { res, body: (await res.json()) as Json };
}

async function connected(userId = EDITOR.subject, scopes: readonly Scope[] = ALL) {
  const ctx = await setup();
  const grant = await makeGrant({ userId, workspaceId: ctx.workspaceId, scopes });
  return { ...ctx, token: grant.accessToken, grantId: grant.grantId };
}

const DSL = `title Shop
type architecture

Web
API
DB

Web > API : HTTPS
API > DB : SQL
`;

const COMPOSE = `services:
  web:
    image: nginx
    ports: ["80:80"]
    depends_on: [api]
  api:
    image: node:20
    depends_on: [db]
  db:
    image: postgres:16
`;

describe("boards.create", () => {
  it("creates a board in the grant's workspace, marked as created through the connector, with metadata and externalRef", async () => {
    const { workspaceId, token } = await connected();
    const { res, body } = await act(token, "boards.create", { title: "  Order platform  ", metadata: { ticket: "ENG-7" }, externalRef: { hubProjectId: "prj_1", hubRunId: "run_2", hubStepId: "step_3" } });
    expect(res.status).toBe(200);
    expect(body.output.board).toMatchObject({
      title: "Order platform",
      status: "draft",
      createdVia: "connector",
      metadata: { ticket: "ENG-7" },
      externalRef: { hubProjectId: "prj_1", hubRunId: "run_2", hubStepId: "step_3" },
    });
    expect(body.output.board.webUrl).toBe(`https://slate.test/canvas/${body.output.board.id}`);
    const c = await getCollections();
    expect(await c.slates.findOne({ _id: body.output.board.id })).toMatchObject({ workspaceId, createdVia: "connector", isArchived: false });
    expect((await read(token, `/boards/${body.output.board.id}`)).body.metadata).toEqual({ ticket: "ENG-7" });
  });

  it("starts from a built-in template and rejects unknown ones", async () => {
    const { token } = await connected();
    const ok = await act(token, "boards.create", { title: "From template", template: "database-erd" });
    expect(ok.res.status).toBe(200);
    expect(ok.body.output.board.stats.nodes).toBeGreaterThan(1);
    const dsl = await read(token, `/boards/${ok.body.output.board.id}/dsl`);
    expect(dsl.body.nodes).toBeGreaterThan(1);

    const bad = await act(token, "boards.create", { title: "x", template: "nope" });
    expect(bad.res.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe("template");
  });

  it("applies the workspace owner's plan limit as 402 plan_limit (free = 3 boards)", async () => {
    const { token } = await connected(); // setup() already holds one board
    expect((await act(token, "boards.create", { title: "two" })).res.status).toBe(200);
    expect((await act(token, "boards.create", { title: "three" })).res.status).toBe(200);
    const { res, body } = await act(token, "boards.create", { title: "four" });
    expect(res.status).toBe(402);
    expect(body.error).toMatchObject({ code: "plan_limit", limit: 3, retryable: false });
  });

  it("validates strictly and never lets a Viewer create (whatever the grant says)", async () => {
    const { token } = await connected();
    expect((await act(token, "boards.create", { title: "" })).res.status).toBe(400);
    expect((await act(token, "boards.create", { title: "ok", surprise: 1 })).res.status).toBe(400);
    expect((await act(token, "boards.create", { title: "ok", metadata: { blob: "x".repeat(3000) } })).res.status).toBe(400);
    expect((await act(token, "boards.create", { title: "ok", externalRef: { hubRunId: "r".repeat(65) } })).res.status).toBe(400);

    const viewer = await makeGrant({ userId: VIEWER.subject, workspaceId: (await (await getCollections()).workspaces.findOne({}))!._id, scopes: ALL });
    const denied = await act(viewer.accessToken, "boards.create", { title: "nope" });
    expect(denied.res.status).toBe(403);
    expect(denied.body.error.code).toBe("forbidden");
  });

  it("creates exactly one board for a repeated Idempotency-Key (C10)", async () => {
    const { token, workspaceId } = await connected();
    const a = await act(token, "boards.create", { title: "Once" }, { "idempotency-key": "k1" });
    const b = await act(token, "boards.create", { title: "Once" }, { "idempotency-key": "k1" });
    expect(b.res.headers.get("idempotent-replay")).toBe("true");
    expect(b.body.output.board.id).toBe(a.body.output.board.id);
    const c = await getCollections();
    expect(await c.slates.countDocuments({ workspaceId, title: "Once" })).toBe(1);
    expect((await act(token, "boards.create", { title: "Different" }, { "idempotency-key": "k1" })).res.status).toBe(422);
  });

  it("needs the write scope and names the action in the audit log", async () => {
    const { token: readOnly } = await connected(EDITOR.subject, ["slate:boards:read"]);
    const denied = await act(readOnly, "boards.create", { title: "x" });
    expect(denied.res.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: "insufficient_scope", requiredScope: "slate:boards:write" });
    const c = await getCollections();
    expect((await c.connectorAudit.find({ route: "boards.create" }).toArray()).length).toBe(1);
    expect((await act(readOnly, "boards.nothing", {})).res.status).toBe(404);
  });
});

describe("boards.importDsl", () => {
  it("creates a board from diagram-as-code when no board is named, and round-trips the DSL", async () => {
    const { token } = await connected();
    const { res, body } = await act(token, "boards.importDsl", { dsl: DSL });
    expect(res.status).toBe(200);
    expect(body.output.board.title).toBe("Shop");
    expect(body.output.diagram).toMatchObject({ kind: "architecture", nodes: 3, edges: 2 });
    expect(body.output.board.stats).toEqual({ nodes: 3, connectors: 2 });
    const dsl = await read(token, `/boards/${body.output.board.id}/dsl`);
    expect(dsl.body).toMatchObject({ nodes: 3, edges: 2 });
    expect(parseDsl(dsl.body.dsl).errors).toEqual([]);
  });

  it("reports syntax errors with their line numbers and writes nothing", async () => {
    const { token, workspaceId } = await connected();
    const bad = await act(token, "boards.importDsl", { dsl: "title X\nWeb > \n??? broken\n" });
    expect(bad.res.status).toBe(422);
    expect(bad.body.error.code).toBe("validation_failed");
    expect(bad.body.error.details.length).toBeGreaterThan(0);
    expect(bad.body.error.details[0]).toMatchObject({ path: expect.stringMatching(/^dsl:\d+$/), message: expect.stringMatching(/^Line \d+/) });
    const c = await getCollections();
    expect(await c.slates.countDocuments({ workspaceId })).toBe(1); // only setup()'s board
  });

  it("replaces (after saving a version) or appends to the right of what is there", async () => {
    const { token, slateId } = await connected();
    await act(token, "boards.importDsl", { boardId: slateId, dsl: DSL });
    const c = await getCollections();
    const before = await c.elements.find({ slateId, deleted: { $ne: true } }).toArray();
    const xs = before.map((e) => JSON.parse(e.data).x as number);

    const replaced = await act(token, "boards.importDsl", { boardId: slateId, dsl: "title Tiny\nA\nB\nA > B\n", mode: "replace" });
    expect(replaced.body.output.board.stats).toEqual({ nodes: 2, connectors: 1 });
    expect(await c.slateVersions.countDocuments({ slateId })).toBe(1); // a safety version was taken first
    expect((await read(token, `/boards/${slateId}/dsl`)).body.nodes).toBe(2);

    const appended = await act(token, "boards.importDsl", { boardId: slateId, dsl: "title More\nC\nD\nC > D\n", mode: "append" });
    expect(appended.body.output.board.stats).toEqual({ nodes: 4, connectors: 2 });
    const rows = await c.elements.find({ slateId, deleted: { $ne: true } }).toArray();
    const parsed = rows.map((r) => JSON.parse(r.data) as { id: string; x: number; type: string; w: number });
    const added = parsed.filter((e) => e.id.includes(":C") || e.id.includes(":D"));
    const old = parsed.filter((e) => (e.id.includes(":A") || e.id.includes(":B")) && e.type !== "connector");
    expect(Math.min(...added.filter((e) => e.type !== "connector").map((e) => e.x))).toBeGreaterThan(Math.max(...old.map((e) => e.x + e.w)));
    expect(xs.length).toBeGreaterThan(0);
  });

  it("does not touch a board of another workspace and needs edit rights", async () => {
    const { token, workspaceId } = await connected();
    const c = await getCollections();
    const otherWs = newDocId();
    await c.workspaces.insertOne({ _id: otherWs, name: "Other", ownerId: "user_stranger", createdAt: 1, updatedAt: 1 });
    const foreign = newDocId();
    await c.slates.insertOne({ _id: foreign, title: "Theirs", workspaceId: otherWs, isArchived: false, createdAt: 1, lastEdited: 1, thumbnailIcon: "1", schemaVersion: 2, elementSeq: 0 });
    const res = await act(token, "boards.importDsl", { boardId: foreign, dsl: DSL });
    expect(res.res.status).toBe(404);

    const viewer = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: ALL });
    const own = (await c.slates.findOne({ workspaceId }))!._id;
    expect((await act(viewer.accessToken, "boards.importDsl", { boardId: own, dsl: DSL })).res.status).toBe(403);
  });
});

describe("boards.importCode", () => {
  it("turns docker-compose into a diagram and writes the generated documentation", async () => {
    const { token, slateId } = await connected();
    const { res, body } = await act(token, "boards.importCode", { boardId: slateId, content: COMPOSE });
    expect(res.status).toBe(200);
    expect(body.output).toMatchObject({ detected: "compose", documentWritten: true });
    expect(body.output.diagram.nodes).toBeGreaterThanOrEqual(3);
    const doc = await read(token, `/boards/${slateId}/document`);
    expect(doc.body.markdown.length).toBeGreaterThan(50);
    expect(doc.body.markdown.toLowerCase()).toContain("postgres");
  });

  it("can skip the documentation, and refuses text it cannot read", async () => {
    const { token, slateId } = await connected();
    const quiet = await act(token, "boards.importCode", { boardId: slateId, content: COMPOSE, format: "docker-compose", document: "none" });
    expect(quiet.body.output.documentWritten).toBe(false);
    expect((await read(token, `/boards/${slateId}/document`)).body.markdown).toBe("");

    const wrongFormat = await act(token, "boards.importCode", { boardId: slateId, content: COMPOSE, format: "sql" });
    expect(wrongFormat.res.status).toBe(422);
    const unknown = await act(token, "boards.importCode", { boardId: slateId, content: "just some prose, nothing to draw here" });
    expect(unknown.res.status).toBe(422);
    expect(unknown.body.error.details[0].path).toBe("content");
  });
});

describe("boards.setDocument", () => {
  it("writes Markdown as both the text and the editor document, and appends without losing what is there", async () => {
    const { token, slateId } = await connected();
    const first = await act(token, "boards.setDocument", { boardId: slateId, markdown: "# Summary\n\nWe chose **Postgres**.\n\n- fast\n- boring" });
    expect(first.res.status).toBe(200);
    const c = await getCollections();
    const slate = (await c.slates.findOne({ _id: slateId }))!;
    expect(slate.documentText).toContain("We chose **Postgres**.");
    const json = JSON.parse(slate.documentJson!);
    expect(json.type).toBe("doc");
    expect(json.content[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(json.content.some((n: Json) => n.type === "bulletList")).toBe(true);

    await act(token, "boards.setDocument", { boardId: slateId, markdown: "## Decisions\n\nShip it.", mode: "append" });
    const after = (await c.slates.findOne({ _id: slateId }))!;
    expect(after.documentText).toContain("# Summary");
    expect(after.documentText).toContain("## Decisions");
    const types = JSON.parse(after.documentJson!).content.map((n: Json) => n.type);
    expect(types.filter((t: string) => t === "heading")).toHaveLength(2);

    await act(token, "boards.setDocument", { boardId: slateId, markdown: "" });
    expect((await read(token, `/boards/${slateId}/document`)).body).toMatchObject({ markdown: "", text: "" });
  });

  it("keeps editor-only content (callouts) when appending", async () => {
    const { token, slateId } = await connected();
    const c = await getCollections();
    const rich = { type: "doc", content: [{ type: "callout", attrs: { type: "info" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Important" }] }] }] };
    await c.slates.updateOne({ _id: slateId }, { $set: { documentText: "Important", documentJson: JSON.stringify(rich) } });
    await act(token, "boards.setDocument", { boardId: slateId, markdown: "More", mode: "append" });
    const types = JSON.parse((await c.slates.findOne({ _id: slateId }))!.documentJson!).content.map((n: Json) => n.type);
    expect(types).toEqual(["callout", "paragraph"]);
  });

  it("rejects a document the app would refuse as too large", async () => {
    const { token, slateId } = await connected();
    // 160k tiny paragraphs fit the request body but not the stored editor document
    const res = await act(token, "boards.setDocument", { boardId: slateId, markdown: "a\n\n".repeat(160_000) });
    expect(res.res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

describe("boards.setStatus and the status events", () => {
  it("moves the board through the review states and emits board.status_changed and board.approved with the creator's externalRef (C18)", async () => {
    const { token, workspaceId } = await connected();
    const created = await act(token, "boards.create", { title: "Design", externalRef: { hubProjectId: "prj_9", hubRunId: "run_9" } });
    const boardId = created.body.output.board.id as string;
    await act(token, "boards.importDsl", { boardId, dsl: DSL });

    const review = await act(token, "boards.setStatus", { boardId, status: "in_review", note: "Please look" });
    expect(review.body.output).toMatchObject({ previousStatus: "draft", changed: true });
    expect(review.body.output.board).toMatchObject({ status: "in_review", statusChangedBy: { id: EDITOR.subject, name: "Edie Editor" } });
    const approved = await act(token, "boards.setStatus", { boardId, status: "approved", note: "LGTM" });
    expect(approved.body.output.board.status).toBe("approved");
    expect((await act(token, "boards.setStatus", { boardId, status: "approved" })).body.output.changed).toBe(false); // no change, no event

    const c = await getCollections();
    const events = await c.connectorEvents.find({ workspaceId }).sort({ cursor: 1 }).toArray();
    expect(events.map((e) => e.type)).toEqual(["board.created", "board.status_changed", "board.status_changed", "board.approved"]);
    expect(events.map((e) => e.cursor)).toEqual([1, 2, 3, 4]);
    for (const e of events) expect(e.externalRef).toEqual({ hubProjectId: "prj_9", hubRunId: "run_9" });
    expect(events[1]).toMatchObject({ actor: { id: EDITOR.subject, kind: "connector" }, data: { from: "draft", to: "in_review", note: "Please look", by: { id: EDITOR.subject, name: "Edie Editor" } } });
    expect(events[3].data).toMatchObject({ note: "LGTM", stats: { nodes: 3, connectors: 2 }, board: { id: boardId, status: "approved" } });
    expect((events[3].data as Json).dslBytes).toBeGreaterThan(20);
    expect(events.every((e) => e.pending === true)).toBe(true); // queued for the dispatcher
  });

  it("is the same logic behind the status pill, so approving in the app emits board.approved too", async () => {
    const { workspaceId, slateId } = await connected();
    await as(OWNER).mutation(api.slates.setStatus, { id: slateId, status: "approved" });
    const c = await getCollections();
    const events = await c.connectorEvents.find({ workspaceId }).sort({ cursor: 1 }).toArray();
    expect(events.map((e) => e.type)).toEqual(["board.status_changed", "board.approved"]);
    expect(events[0].actor).toMatchObject({ id: OWNER.subject, kind: "user" });
    const view = await as(OWNER).query(api.slates.getById, { id: slateId });
    expect(view?.connector).toMatchObject({ status: "approved", statusChangedByName: "Owner One", createdVia: "ui", hubName: "Test Hub" });
    await expect(as(VIEWER).mutation(api.slates.setStatus, { id: slateId, status: "draft" })).rejects.toThrow();
    const list = await as(OWNER).query(api.slates.list, { workspaceId });
    expect(list[0].status).toBe("approved");
  });

  it("is for Admins and Editors only", async () => {
    const { workspaceId, slateId } = await connected();
    const viewer = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: ALL });
    const denied = await act(viewer.accessToken, "boards.setStatus", { boardId: slateId, status: "approved" });
    expect(denied.res.status).toBe(403);
    const c = await getCollections();
    expect((await c.slates.findOne({ _id: slateId }))!.status).toBeUndefined();
  });

  it("writes no events at all when no app is connected to the workspace", async () => {
    const { workspaceId, slateId } = await setup();
    await as(EDITOR).mutation(api.slates.setStatus, { id: slateId, status: "in_review" });
    const c = await getCollections();
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(0);
    expect((await c.slates.findOne({ _id: slateId }))!.status).toBe("in_review");
  });
});

describe("boards.setSharing and boards.archive", () => {
  it("changes link access, returns the public link and emits board.shared only on a real change", async () => {
    const { token, slateId, workspaceId } = await connected();
    const on = await act(token, "boards.setSharing", { boardId: slateId, linkAccess: "view" });
    expect(on.body.output).toMatchObject({ publicUrl: `https://slate.test/canvas/${slateId}`, board: { linkAccess: "view" } });
    await act(token, "boards.setSharing", { boardId: slateId, linkAccess: "view" });
    const off = await act(token, "boards.setSharing", { boardId: slateId, linkAccess: "none" });
    expect(off.body.output.publicUrl).toBeNull();
    const c = await getCollections();
    const events = await c.connectorEvents.find({ workspaceId, type: "board.shared" }).sort({ cursor: 1 }).toArray();
    expect(events.map((e) => (e.data as Json).linkAccess)).toEqual(["view", "none"]);
    expect((await act(token, "boards.setSharing", { boardId: slateId, linkAccess: "everyone" })).res.status).toBe(400);
  });

  it("archives softly: gone from the lists, 404 afterwards, nothing deleted, board.archived emitted", async () => {
    const { token, slateId, workspaceId } = await connected();
    const done = await act(token, "boards.archive", { boardId: slateId });
    expect(done.body.output).toMatchObject({ archived: true, board: { id: slateId } });
    expect((await read(token, "/boards")).body.items).toEqual([]);
    expect((await read(token, `/boards/${slateId}`)).res.status).toBe(404);
    expect((await act(token, "boards.archive", { boardId: slateId })).res.status).toBe(404);
    const c = await getCollections();
    expect((await c.slates.findOne({ _id: slateId }))!.isArchived).toBe(true);
    expect((await c.connectorEvents.find({ workspaceId, type: "board.archived" }).toArray()).length).toBe(1);
  });
});

describe("boards.export", () => {
  it("exports dsl, json, svg and markdown inline", async () => {
    const { token, slateId } = await connected();
    await act(token, "boards.importDsl", { boardId: slateId, dsl: DSL });
    await act(token, "boards.setDocument", { boardId: slateId, markdown: "# Shop\n\nNotes." });

    const dsl = await act(token, "boards.export", { boardId: slateId, format: "dsl" });
    expect(dsl.body.output).toMatchObject({ format: "dsl", bytes: expect.any(Number) });
    expect(parseDsl(dsl.body.output.content).graph.nodes).toHaveLength(3);

    const json = JSON.parse((await act(token, "boards.export", { boardId: slateId, format: "json" })).body.output.content);
    expect(json).toMatchObject({ kind: "slate-board", version: 2 });
    expect(json.elements.length).toBeGreaterThanOrEqual(5); // 3 components and 2 connections

    const svg = (await act(token, "boards.export", { boardId: slateId, format: "svg" })).body.output.content as string;
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain("<svg");

    const md = (await act(token, "boards.export", { boardId: slateId, format: "markdown" })).body.output.content as string;
    expect(md).toContain("# Shop");
    expect(md).toContain("Notes.");
    expect(md).toContain("```mermaid\nflowchart");
    expect(md).toContain("```slate-dsl");
    expect(md).toContain("HTTPS");
  });

  it("handles an empty board and a foreign one", async () => {
    const { token, slateId } = await connected();
    expect((await act(token, "boards.export", { boardId: slateId, format: "svg" })).res.status).toBe(412);
    expect((await act(token, "boards.export", { boardId: slateId, format: "dsl" })).body.output.content).toBe("");
    expect((await act(token, "boards.export", { boardId: newDocId(), format: "json" })).res.status).toBe(404);
    expect((await act(token, "boards.export", { boardId: slateId, format: "pdf" })).res.status).toBe(400);
  });

  it("works with the read scope alone", async () => {
    const { token, slateId } = await connected(EDITOR.subject, ["slate:boards:read"]);
    expect((await act(token, "boards.export", { boardId: slateId, format: "json" })).res.status).toBe(200);
  });
});
