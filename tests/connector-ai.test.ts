import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GET as opRoute } from "@/app/api/connect/v1/operations/[id]/route";
import { POST as actionRoute } from "@/app/api/connect/v1/actions/[name]/route";
import { GET as readRoute } from "@/app/api/connect/v1/[...path]/route";
import { AiError, streamChat } from "@/lib/ai/nvidia";
import { rectsOverlap } from "@/lib/canvas/geometry";
import type { El } from "@/lib/canvas/types";
import { settleDeferred } from "@/lib/connector/defer";
import { reapIfStale } from "@/lib/connector/operations";
import type { Scope } from "@/lib/connector/scopes";
import { getCollections } from "@/lib/db/mongo";
import { bearer, disableConnector, enableConnector, makeGrant, req, seedUsers } from "./helpers/connector";
import { EDITOR, resetDb, setup, startDb, stopDb, VIEWER } from "./helpers/db";

vi.mock("@/lib/ai/nvidia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/nvidia")>();
  return { ...actual, streamChat: vi.fn() };
});
const model = streamChat as unknown as Mock;

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
  process.env.NVIDIA_API_KEY = "test-key";
  model.mockReset();
  model.mockResolvedValue({ text: JSON.stringify(GRAPH), finishReason: "stop" });
});
afterEach(() => {
  delete process.env.NVIDIA_API_KEY;
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ALL: Scope[] = ["slate:workspaces:read", "slate:boards:read", "slate:boards:write", "slate:ai:generate", "slate:comments:read", "slate:events:read"];

/** What a model would answer: 12 services, three groups, long labels (the layout must still keep them apart). */
const GRAPH = {
  kind: "architecture",
  title: "Checkout platform",
  groups: [
    { id: "edge", label: "Edge" },
    { id: "core", label: "Core services" },
    { id: "data", label: "Data" },
  ],
  nodes: [
    { id: "web", label: "Web storefront with a long descriptive name", subtitle: "Next.js" },
    { id: "cdn", label: "CDN", group: "edge" },
    { id: "gw", label: "API gateway", subtitle: "authn, rate limits", group: "edge" },
    { id: "auth", label: "Authentication service", group: "core" },
    { id: "orders", label: "Order service", group: "core" },
    { id: "pay", label: "Payment service", subtitle: "Stripe", group: "core" },
    { id: "inv", label: "Inventory service", group: "core" },
    { id: "pg", label: "PostgreSQL", subtitle: "orders", group: "data" },
    { id: "redis", label: "Redis", subtitle: "sessions", group: "data" },
    { id: "kafka", label: "Kafka", subtitle: "order events", group: "data" },
    { id: "worker", label: "Fulfilment worker", group: "core" },
    { id: "mail", label: "Email provider" },
  ],
  edges: [
    { from: "web", to: "cdn" },
    { from: "cdn", to: "gw" },
    { from: "gw", to: "auth", label: "verify" },
    { from: "gw", to: "orders" },
    { from: "orders", to: "pay", label: "charge" },
    { from: "orders", to: "inv" },
    { from: "orders", to: "pg" },
    { from: "auth", to: "redis" },
    { from: "orders", to: "kafka", style: "dashed" },
    { from: "kafka", to: "worker" },
    { from: "worker", to: "mail" },
  ],
};

async function act(token: string, name: string, input: unknown, headers: Record<string, string> = {}) {
  const res = await actionRoute(req(`/api/connect/v1/actions/${name}`, { headers: bearer(token, headers), body: { input } }), { params: Promise.resolve({ name }) });
  return { res, body: (await res.json()) as Json };
}

async function operation(token: string, id: string) {
  const res = await opRoute(req(`/api/connect/v1/operations/${id}`, { headers: bearer(token) }), { params: Promise.resolve({ id }) });
  return { res, body: (await res.json()) as Json };
}

/** Starts an async action and waits for the background work, like a caller polling until the state is terminal. */
async function run(token: string, name: string, input: unknown, headers: Record<string, string> = {}) {
  const accepted = await act(token, name, input, headers);
  if (accepted.res.status !== 202) return { accepted, final: null as Json | null };
  await settleDeferred();
  return { accepted, final: (await operation(token, accepted.body.operation.id)).body };
}

async function read(token: string, path: string) {
  const res = await readRoute(req(`/api/connect/v1${path}`, { headers: bearer(token) }), { params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }) });
  return { res, body: (await res.json()) as Json };
}

async function connected(userId = EDITOR.subject, scopes: readonly Scope[] = ALL) {
  const ctx = await setup();
  const grant = await makeGrant({ userId, workspaceId: ctx.workspaceId, scopes });
  return { ...ctx, token: grant.accessToken, grantId: grant.grantId, userId };
}

const creditsUsed = async (userId = EDITOR.subject) => (await (await getCollections()).users.findOne({ clerkId: userId }))?.aiCreditsUsedThisPeriod ?? 0;

describe("boards.generateDiagram (async)", () => {
  it("answers 202 with an operation, then delivers a laid-out diagram, the document and the credit balance (C14)", async () => {
    const { token } = await connected();
    const { accepted, final } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform", title: "Checkout", document: { markdown: "# Meeting summary\n\nWe decided to use Kafka." } }, { "x-request-id": "gen-1" });

    expect(accepted.res.status).toBe(202);
    expect(accepted.res.headers.get("location")).toBe(accepted.body.operation.pollUrl);
    expect(accepted.body.operation).toMatchObject({ status: "pending", action: "boards.generateDiagram", pollUrl: expect.stringContaining("/api/connect/v1/operations/op_") });

    expect(final).toMatchObject({ status: "succeeded", id: accepted.body.operation.id, finishedAt: expect.any(String) });
    const out = final!.output;
    expect(out.board).toMatchObject({ title: "Checkout", createdVia: "connector", stats: { nodes: 12 } });
    expect(out.diagram).toMatchObject({ kind: "architecture", nodes: 12, edges: 11, groups: 3 });
    expect(out.model).toBeTruthy();
    expect(out.credits).toEqual({ used: 1, cap: 15, remaining: 14 });
    expect(await creditsUsed()).toBe(1);

    // the document pane holds the summary, the diagram is on the board and the DSL round-trips
    expect((await read(token, `/boards/${out.board.id}/document`)).body.markdown).toContain("We decided to use Kafka.");
    expect((await read(token, `/boards/${out.board.id}/dsl`)).body).toMatchObject({ nodes: 12 });
  });

  it("lays the diagram out without any overlapping nodes (server-side layout)", async () => {
    const { token } = await connected();
    const { final } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    const c = await getCollections();
    const rows = await c.elements.find({ slateId: final!.output.board.id, deleted: { $ne: true } }).toArray();
    const els = rows.map((r) => JSON.parse(r.data) as El);
    expect(els.length).toBeGreaterThan(20); // 12 nodes, 11 connectors, 3 frames
    const nodes = els.filter((e) => e.type !== "connector" && e.type !== "frame");
    expect(nodes).toHaveLength(12);
    const bad: string[] = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (rectsOverlap(nodes[i], nodes[j], 4)) bad.push(`${nodes[i].id} x ${nodes[j].id}`);
    expect(bad).toEqual([]);
    expect(new Set(els.map((e) => e.diagramId)).size).toBe(1); // one diagram, so "Edit this diagram" finds it
  });

  it("replaces or appends on an existing board and tells the team through events", async () => {
    const { token, slateId, workspaceId } = await connected();
    await run(token, "boards.generateDiagram", { boardId: slateId, prompt: "first" });
    const second = await run(token, "boards.generateDiagram", { boardId: slateId, prompt: "second", mode: "append" });
    expect(second.final!.output.board.stats.nodes).toBe(24);
    const third = await run(token, "boards.generateDiagram", { boardId: slateId, prompt: "third", mode: "replace" });
    expect(third.final!.output.board.stats.nodes).toBe(12);
    const c = await getCollections();
    expect(await c.slateVersions.countDocuments({ slateId })).toBeGreaterThanOrEqual(1);

    const types = (await c.connectorEvents.find({ workspaceId }).sort({ cursor: 1 }).toArray()).map((e) => e.type);
    expect(types.filter((t) => t === "board.generation.started")).toHaveLength(3);
    expect(types.filter((t) => t === "board.generation.completed")).toHaveLength(3);
    const started = (await c.connectorEvents.findOne({ workspaceId, type: "board.generation.started" }))!;
    expect(started.data.operationId).toMatch(/^op_/);
  });

  it("hands the credit back, once, and reports the failure when the model never delivers (C14)", async () => {
    const { token, workspaceId } = await connected();
    model.mockRejectedValue(new AiError("upstream", "provider exploded with secret details"));
    const { accepted, final } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    expect(accepted.res.status).toBe(202);
    expect(final).toMatchObject({ status: "failed", error: { code: "upstream_failed", retryable: true } });
    expect(JSON.stringify(final)).not.toContain("secret details");
    expect(await creditsUsed()).toBe(0);

    // polling again, or the reaper looking at it, never refunds twice
    await operation(token, accepted.body.operation.id);
    const c = await getCollections();
    await reapIfStale((await c.connectorOperations.findOne({ _id: accepted.body.operation.id }))!);
    expect(await creditsUsed()).toBe(0);
    const failed = await c.connectorEvents.findOne({ workspaceId, type: "board.generation.failed" });
    expect(failed?.data).toMatchObject({ operationId: accepted.body.operation.id, error: { code: "upstream_failed" } });
  });

  it("answers 402 plan_limit with the reset time when the credits are used up, and leaves no empty board behind", async () => {
    const { token, workspaceId } = await connected();
    const c = await getCollections();
    await c.users.updateOne({ clerkId: EDITOR.subject }, { $set: { aiCreditsUsedThisPeriod: 15, aiCreditsPeriodStart: Date.now() - 1000 } });
    const { accepted } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    expect(accepted.res.status).toBe(402);
    expect(accepted.body.error).toMatchObject({ code: "plan_limit", limit: 15, reason: "credits_exhausted", retryable: false });
    expect(new Date(accepted.body.error.resetsAt).getTime()).toBeGreaterThan(Date.now());
    expect(model).not.toHaveBeenCalled();
    expect(await c.connectorOperations.countDocuments({})).toBe(0);
    expect(await c.slates.countDocuments({ workspaceId, isArchived: false })).toBe(1); // only setup()'s board
  });

  it("applies the board limit to the board it would create (402) before spending anything", async () => {
    const { token } = await connected();
    await act(token, "boards.create", { title: "two" });
    await act(token, "boards.create", { title: "three" });
    const { accepted } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    expect(accepted.res.status).toBe(402);
    expect(accepted.body.error.reason).toBe("board_limit");
    expect(await creditsUsed()).toBe(0);
  });

  it("is unavailable, free of charge, when no model is configured", async () => {
    const { token } = await connected();
    delete process.env.NVIDIA_API_KEY;
    const { accepted } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    expect(accepted.res.status).toBe(503);
    expect(accepted.body.error).toMatchObject({ code: "unavailable", retryable: true });
    expect(await creditsUsed()).toBe(0);
  });

  it("needs both scopes, edit rights and valid input", async () => {
    const { token: noAi } = await connected(EDITOR.subject, ["slate:boards:write", "slate:boards:read"]);
    const denied = await act(noAi, "boards.generateDiagram", { prompt: "x y z" });
    expect(denied.res.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: "insufficient_scope", requiredScope: "slate:ai:generate" });

    const { token, workspaceId } = await connected();
    const viewer = await makeGrant({ userId: VIEWER.subject, workspaceId, scopes: ALL });
    expect((await act(viewer.accessToken, "boards.generateDiagram", { prompt: "A checkout platform" })).res.status).toBe(403);
    expect((await act(token, "boards.generateDiagram", { prompt: "ab" })).res.status).toBe(400);
    expect((await act(token, "boards.generateDiagram", { prompt: "x".repeat(2001) })).res.status).toBe(400);
    expect((await act(token, "boards.generateDiagram", { prompt: "A checkout platform", kind: "pie" })).res.status).toBe(400);
    expect(model).not.toHaveBeenCalled();
  });

  it("spends one credit however often an Idempotency-Key request is repeated", async () => {
    const { token } = await connected();
    const a = await act(token, "boards.generateDiagram", { prompt: "A checkout platform" }, { "idempotency-key": "gen-k" });
    const b = await act(token, "boards.generateDiagram", { prompt: "A checkout platform" }, { "idempotency-key": "gen-k" });
    expect(b.res.headers.get("idempotent-replay")).toBe("true");
    expect(b.body.operation.id).toBe(a.body.operation.id);
    await settleDeferred();
    expect(await creditsUsed()).toBe(1);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("keeps operations private to the connection that started them and requires the action's scopes to read them", async () => {
    const { token, workspaceId } = await connected();
    const { accepted } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    const id = accepted.body.operation.id as string;
    const other = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: ALL });
    expect((await operation(other.accessToken, id)).res.status).toBe(404);
    expect((await operation(token, "op_nope")).res.status).toBe(404);
    const noAi = await makeGrant({ userId: EDITOR.subject, workspaceId, scopes: ["slate:boards:read"] });
    const c = await getCollections();
    await c.connectorOperations.updateOne({ _id: id }, { $set: { grantId: noAi.grantId } });
    const res = await operation(noAi.accessToken, id);
    expect(res.res.status).toBe(403);
  });

  it("fails an operation whose worker died, returns its credit once, and survives a poll storm", async () => {
    const { token, grantId, workspaceId } = await connected();
    const c = await getCollections();
    await c.users.updateOne({ clerkId: EDITOR.subject }, { $set: { aiCreditsUsedThisPeriod: 1, aiCreditsPeriodStart: Date.now() } });
    const now = Date.now();
    await c.connectorOperations.insertOne({ _id: "op_dead", grantId, workspaceId, action: "boards.generateDiagram", status: "running", input: {}, creditsReserved: 1, leaseUntil: now - 1000, createdAt: now - 400_000, expireAt: new Date(now + 1e9) });
    const polls = await Promise.all([operation(token, "op_dead"), operation(token, "op_dead"), operation(token, "op_dead")]);
    for (const p of polls) expect(p.body).toMatchObject({ status: "failed", error: { code: "upstream_failed", retryable: true } });
    expect(await creditsUsed()).toBe(0);
  });
});

describe("boards.review", () => {
  it("gives an instant structural review for free", async () => {
    const { token } = await connected();
    const { final } = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    const id = final!.output.board.id;
    const before = await creditsUsed();
    const { res, body } = await act(token, "boards.review", { boardId: id });
    expect(res.status).toBe(200);
    expect(body.output.mode).toBe("structural");
    expect(body.output.review).toMatchObject({ source: "heuristic", score: expect.any(Number), categories: expect.any(Array) });
    expect(body.output.review.categories).toHaveLength(5);
    expect(await creditsUsed()).toBe(before);
  });

  it("refuses an empty board, and an AI review without the AI scope", async () => {
    const { token, slateId } = await connected();
    const empty = await act(token, "boards.review", { boardId: slateId });
    expect(empty.res.status).toBe(412);
    expect(empty.body.error.code).toBe("precondition_failed");

    const gen = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    const { token: readOnly } = await connected(EDITOR.subject, ["slate:boards:read"]);
    void readOnly;
    const c = await getCollections();
    const grant = await makeGrant({ userId: EDITOR.subject, workspaceId: (await c.slates.findOne({ _id: gen.final!.output.board.id }))!.workspaceId!, scopes: ["slate:boards:read"] });
    const denied = await act(grant.accessToken, "boards.review", { boardId: gen.final!.output.board.id, mode: "ai" });
    expect(denied.res.status).toBe(403);
    expect(denied.body.error.code).toBe("insufficient_scope");
  });

  it("runs the model review for one credit and refunds it when the model fails", async () => {
    const { token } = await connected();
    const gen = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    const id = gen.final!.output.board.id;
    expect(await creditsUsed()).toBe(1);

    const categories = ["scalability", "availability", "data", "caching", "tradeoffs"].map((cid) => ({ id: cid, score: 7, feedback: "Reasonable.", suggestions: ["Add a cache"] }));
    const reviewJson = { score: 70, summary: "Solid", categories, strengths: ["Clear edge"], gaps: ["No cache"] };
    model.mockResolvedValue({ text: JSON.stringify(reviewJson), finishReason: "stop" });
    const ok = await act(token, "boards.review", { boardId: id, mode: "ai" });
    expect(ok.res.status).toBe(200);
    expect(ok.body.output).toMatchObject({ mode: "ai", review: { source: "ai", summary: "Solid" }, credits: { used: 2, cap: 15, remaining: 13 } });

    model.mockRejectedValue(new AiError("upstream", "down"));
    const failed = await act(token, "boards.review", { boardId: id, mode: "ai" });
    expect(failed.res.status).toBe(502);
    expect(await creditsUsed()).toBe(2); // the failed attempt was refunded
  });
});

describe("boards.estimateCost and boards.analyzeResilience", () => {
  it("returns the itemised estimate on the free plan (always itemised through the connector)", async () => {
    const { token } = await connected();
    const created = await act(token, "boards.create", { title: "AWS", template: "aws-microservices" });
    const { res, body } = await act(token, "boards.estimateCost", { boardId: created.body.output.board.id });
    expect(res.status).toBe(200);
    const out = body.output;
    expect(out.monthlyUsd).toBeGreaterThan(0);
    expect(out.byComponent.length).toBeGreaterThan(2);
    expect(out.byComponent[0]).toMatchObject({ label: expect.any(String), service: expect.any(String), provider: expect.any(String), assumption: expect.any(String), monthlyUsd: expect.any(Number) });
    expect(Math.round(out.byComponent.reduce((n: number, i: Json) => n + i.monthlyUsd, 0) * 100) / 100).toBeCloseTo(out.monthlyUsd, 1);
    expect(Array.isArray(out.tips)).toBe(true);
  });

  it("returns zero for a board with nothing to price, and the single points of failure otherwise", async () => {
    const { token, slateId } = await connected();
    expect((await act(token, "boards.estimateCost", { boardId: slateId })).body.output).toMatchObject({ monthlyUsd: 0, byComponent: [] });
    expect((await act(token, "boards.analyzeResilience", { boardId: slateId })).body.output).toMatchObject({ singlePointsOfFailure: [], summary: { total: 0 } });

    const gen = await run(token, "boards.generateDiagram", { prompt: "A checkout platform" });
    const r = await act(token, "boards.analyzeResilience", { boardId: gen.final!.output.board.id });
    expect(r.res.status).toBe(200);
    const out = r.body.output;
    expect(out.summary.total).toBe(out.singlePointsOfFailure.length);
    expect(out.summary.high + out.summary.medium).toBe(out.summary.total);
    for (const s of out.singlePointsOfFailure) expect(s).toMatchObject({ severity: expect.stringMatching(/^(high|medium)$/), dependents: expect.any(Number), message: expect.any(String) });
  });

  it("only works on boards of the connected workspace", async () => {
    const { token } = await connected();
    expect((await act(token, "boards.estimateCost", { boardId: "6aecb9f785dc2ae6b34648fb" })).res.status).toBe(404);
    expect((await act(token, "boards.analyzeResilience", { boardId: "6aecb9f785dc2ae6b34648fb" })).res.status).toBe(404);
  });
});
