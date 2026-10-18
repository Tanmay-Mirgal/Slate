// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import schema from "@/convex/schema";
import { SHARD_COUNT } from "@/convex/shards";
import { MAX_AUTO_VERSIONS, MAX_MANUAL_VERSIONS, parseSnapshot } from "@/convex/snapshot";

const modules = import.meta.glob(["../convex/**/*.{js,ts}", "!../convex/**/*.d.ts"]);

const OWNER = { subject: "user_owner", email: "owner@example.com", name: "Owner" };
const EDITOR = { subject: "user_editor", email: "editor@example.com", name: "Editor" };
const VIEWER = { subject: "user_viewer", email: "viewer@example.com", name: "Viewer" };
const STRANGER = { subject: "user_stranger", email: "stranger@example.com", name: "Stranger" };

async function setup() {
  const t = convexTest(schema, modules);
  const { workspaceId, slateId } = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", { name: "WS", ownerId: OWNER.subject, createdAt: 1, updatedAt: 1 });
    for (const [u, role] of [
      [OWNER, "Admin"],
      [EDITOR, "Editor"],
      [VIEWER, "Viewer"],
    ] as const) {
      await ctx.db.insert("workspace_members", { workspaceId, userId: u.subject, role, addedAt: 1 });
    }
    const slateId = await ctx.db.insert("slates", { title: "Board", workspaceId, isArchived: false, lastEdited: 1, thumbnailIcon: "1", linkAccess: "none", schemaVersion: 2 });
    return { workspaceId, slateId };
  });
  return { t, workspaceId, slateId };
}

const put = (id: string, z = 1, extra: object = {}) => ({ t: "put" as const, id, z, data: JSON.stringify({ id, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, z, ...extra }) });

async function allRows(t: ReturnType<typeof convexTest>, slateId: Id<"slates">, as = OWNER) {
  const rows: { eid: string; rev: number; z: number }[] = [];
  for (let s = 0; s < SHARD_COUNT; s++) rows.push(...(await t.withIdentity(as).query(api.elements.list, { slateId, shard: s })));
  return rows;
}

describe("elements", () => {
  it("stores one row per element, spread over shards, and returns them all", async () => {
    const { t, slateId } = await setup();
    const ops = Array.from({ length: 40 }, (_, i) => put(`e${i}`, i));
    await t.withIdentity(EDITOR).mutation(api.elements.apply, { slateId, ops });
    const rows = await allRows(t, slateId, VIEWER);
    expect(rows).toHaveLength(40);
    const counts: number[] = [];
    for (let s = 0; s < SHARD_COUNT; s++) counts.push((await t.withIdentity(OWNER).query(api.elements.list, { slateId, shard: s })).length);
    expect(counts.every((c) => c > 0)).toBe(true);
  });

  it("bumps rev only when something changed and honours deletes", async () => {
    const { t, slateId } = await setup();
    const as = t.withIdentity(EDITOR);
    await as.mutation(api.elements.apply, { slateId, ops: [put("a", 1)] });
    await as.mutation(api.elements.apply, { slateId, ops: [put("a", 1)] }); // identical
    expect((await allRows(t, slateId))[0].rev).toBe(1);
    await as.mutation(api.elements.apply, { slateId, ops: [put("a", 2)] });
    expect((await allRows(t, slateId))[0].rev).toBe(2);
    await as.mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "a" }, { t: "del", id: "missing" }] });
    expect(await allRows(t, slateId)).toHaveLength(0);
  });

  it("collapses repeated ops on one element within a batch (last wins)", async () => {
    const { t, slateId } = await setup();
    await t.withIdentity(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a", 1, { x: 1 }), put("a", 2, { x: 99 }), put("b", 3), { t: "del", id: "b" }] });
    const rows = await allRows(t, slateId);
    expect(rows.map((r) => r.eid)).toEqual(["a"]);
    expect(rows[0].z).toBe(2);
  });

  it("rejects oversize batches, elements and bad ids", async () => {
    const { t, slateId } = await setup();
    const as = t.withIdentity(EDITOR);
    await expect(as.mutation(api.elements.apply, { slateId, ops: Array.from({ length: 501 }, (_, i) => put(`x${i}`)) })).rejects.toThrow(/Too many/);
    await expect(as.mutation(api.elements.apply, { slateId, ops: [{ t: "put", id: "big", z: 1, data: "x".repeat(260_000) }] })).rejects.toThrow(/too large/);
    await expect(as.mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "" }] })).rejects.toThrow(/Invalid element id/);
  });

  it("migrates a legacy board once, only for editors", async () => {
    const { t, slateId } = await setup();
    await t.run((ctx) => ctx.db.patch(slateId, { elements: JSON.stringify([{ id: "old" }]), schemaVersion: 1 }));
    const view = await t.withIdentity(VIEWER).query(api.slates.getById, { id: slateId });
    expect(view?.legacyElements).toContain("old");
    await expect(t.withIdentity(VIEWER).mutation(api.elements.importLegacy, { slateId, ops: [put("m1")] })).rejects.toThrow();
    const r1 = await t.withIdentity(EDITOR).mutation(api.elements.importLegacy, { slateId, ops: [put("m1"), put("m2")] });
    expect(r1.imported).toBe(2);
    const after = await t.withIdentity(EDITOR).query(api.slates.getById, { id: slateId });
    expect(after?.legacyElements).toBeUndefined();
    const r2 = await t.withIdentity(EDITOR).mutation(api.elements.importLegacy, { slateId, ops: [put("m3")] });
    expect(r2.imported).toBe(0);
    expect(await allRows(t, slateId)).toHaveLength(2);
  });
});

describe("access control", () => {
  it("viewers can read but not write; strangers can't even read", async () => {
    const { t, slateId } = await setup();
    await t.withIdentity(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    expect(await allRows(t, slateId, VIEWER)).toHaveLength(1);
    await expect(t.withIdentity(VIEWER).mutation(api.elements.apply, { slateId, ops: [put("b")] })).rejects.toThrow(/view access/);
    expect(await allRows(t, slateId, STRANGER)).toHaveLength(0);
    expect(await t.withIdentity(STRANGER).query(api.slates.getById, { id: slateId })).toBeNull();
    expect(await t.query(api.slates.getById, { id: slateId })).toBeNull();
    await expect(t.withIdentity(STRANGER).mutation(api.elements.apply, { slateId, ops: [put("c")] })).rejects.toThrow();
  });

  it("link sharing: view opens it to everyone, edit lets signed-in users write", async () => {
    const { t, slateId } = await setup();
    await t.withIdentity(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });

    // only workspace members can change sharing
    await expect(t.withIdentity(STRANGER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" })).rejects.toThrow();

    await t.withIdentity(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
    const anon = await t.query(api.slates.getById, { id: slateId });
    expect(anon?.access).toBe("view");
    expect(anon?.canManage).toBe(false);
    expect((await t.query(api.elements.list, { slateId, shard: 0 })).length + (await t.query(api.elements.list, { slateId, shard: 1 })).length + (await t.query(api.elements.list, { slateId, shard: 2 })).length + (await t.query(api.elements.list, { slateId, shard: 3 })).length).toBe(1);
    await expect(t.withIdentity(STRANGER).mutation(api.elements.apply, { slateId, ops: [put("x")] })).rejects.toThrow(/view access/);

    await t.withIdentity(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" });
    await t.withIdentity(STRANGER).mutation(api.elements.apply, { slateId, ops: [put("by-stranger")] });
    expect((await allRows(t, slateId)).map((r) => r.eid).sort()).toEqual(["a", "by-stranger"]);
    // anonymous visitors stay read-only even on "edit" links
    await expect(t.mutation(api.elements.apply, { slateId, ops: [put("anon")] })).rejects.toThrow();
    // a link editor can't rename or delete the board
    await expect(t.withIdentity(STRANGER).mutation(api.slates.rename, { id: slateId, title: "Hijacked" })).rejects.toThrow(/workspace members/);
    await expect(t.withIdentity(STRANGER).mutation(api.slates.remove, { id: slateId })).rejects.toThrow();
  });

  it("archived slates disappear for everyone", async () => {
    const { t, slateId } = await setup();
    await t.withIdentity(OWNER).mutation(api.slates.remove, { id: slateId });
    expect(await t.withIdentity(OWNER).query(api.slates.getById, { id: slateId })).toBeNull();
    expect(await allRows(t, slateId)).toHaveLength(0);
  });

  it("legacy slates without a workspace stay editable by their original owner only", async () => {
    const t = convexTest(schema, modules);
    const slateId = await t.run((ctx) => ctx.db.insert("slates", { title: "Old", isArchived: false, lastEdited: 1, thumbnailIcon: "1", userId: OWNER.subject }));
    expect((await t.withIdentity(OWNER).query(api.slates.getById, { id: slateId }))?.access).toBe("edit");
    expect(await t.withIdentity(STRANGER).query(api.slates.getById, { id: slateId })).toBeNull();
  });
});

describe("slate lists", () => {
  it("returns lightweight summaries newest first and hides archived ones", async () => {
    const { t, workspaceId } = await setup();
    const as = t.withIdentity(OWNER);
    const a = await as.mutation(api.slates.create, { title: "A", workspaceId, thumbnailIcon: "1" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await as.mutation(api.slates.create, { title: "B", workspaceId, thumbnailIcon: "2" });
    await as.mutation(api.slates.remove, { id: a });
    const list = await as.query(api.slates.list, { workspaceId });
    expect(list.map((s) => s.title)).toEqual(["B", "Board"]);
    expect(list[0]._id).toBe(b);
    expect(Object.keys(list[0])).not.toContain("elements");
    expect(Object.keys(list[0])).not.toContain("documentText");
    await expect(t.withIdentity(VIEWER).mutation(api.slates.create, { title: "X", workspaceId, thumbnailIcon: "1" })).rejects.toThrow();
  });
});

describe("presence", () => {
  it("joins, updates, lists and leaves", async () => {
    const { t, slateId } = await setup();
    const id = await t.withIdentity(EDITOR).mutation(api.presence.join, { slateId, sessionId: "tab1", name: "Ed", color: "#ff0000" });
    const again = await t.withIdentity(EDITOR).mutation(api.presence.join, { slateId, sessionId: "tab1", name: "Ed R.", color: "#ff0000" });
    expect(again).toEqual(id); // re-joining the same tab reuses the row
    expect(await t.withIdentity(EDITOR).mutation(api.presence.update, { id, cursor: { x: 10.5, y: -4 }, selection: ["a", "b"], tool: "select" })).toBe(true);
    const peers = await t.withIdentity(OWNER).query(api.presence.list, { slateId });
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ name: "Ed R.", cursor: { x: 10.5, y: -4 }, selection: ["a", "b"] });
    await t.withIdentity(EDITOR).mutation(api.presence.leave, { id });
    expect(await t.withIdentity(OWNER).query(api.presence.list, { slateId })).toHaveLength(0);
    // updating a swept row reports false so the client can re-join
    expect(await t.withIdentity(EDITOR).mutation(api.presence.update, { id, cursor: null, selection: [] })).toBe(false);
  });

  it("keeps strangers out and sanitises input", async () => {
    const { t, slateId } = await setup();
    await expect(t.withIdentity(STRANGER).mutation(api.presence.join, { slateId, sessionId: "x", name: "Eve", color: "#000000" })).rejects.toThrow();
    await t.withIdentity(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
    const id = await t.mutation(api.presence.join, { slateId, sessionId: "anon1", name: "  " + "x".repeat(200), color: "not-a-colour" });
    const [p] = await t.query(api.presence.list, { slateId });
    expect(p.name.length).toBeLessThanOrEqual(60);
    expect(p.color).toBe("#6366f1");
    expect(p.userId).toBe("anon:anon1");
    await t.mutation(api.presence.update, { id, cursor: { x: 1e12, y: Number.NaN }, selection: Array.from({ length: 500 }, (_, i) => `s${i}`) });
    const [q] = await t.query(api.presence.list, { slateId });
    expect(q.selection.length).toBeLessThanOrEqual(60);
    expect(Math.abs(q.cursor!.x)).toBeLessThanOrEqual(1e7);
  });

  it("the sweeper removes stale sessions and drains the legacy presence table", async () => {
    const { t, slateId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("liveSessions", { slateId, sessionId: "old", userId: "u", name: "Old", color: "#000000", cursor: null, selection: [], lastSeen: Date.now() - 10 * 60_000 });
      await ctx.db.insert("liveSessions", { slateId, sessionId: "new", userId: "u", name: "New", color: "#000000", cursor: null, selection: [], lastSeen: Date.now() });
      await ctx.db.insert("presence", { slateId, userId: "u", userName: "Legacy", cursorX: 0, cursorY: 0, lastSeen: 1 });
    });
    const r = await t.mutation(internal.maintenance.sweepSessions, {});
    expect(r).toEqual({ sessions: 1, legacy: 1 });
    const left = await t.run((ctx) => ctx.db.query("liveSessions").collect());
    expect(left.map((s) => s.sessionId)).toEqual(["new"]);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per user per window, then blocks with a retry time", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(OWNER);
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await as.mutation(api.usage.consume, { bucket: "ai", limit: 3, windowMs: 60_000 }));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, true, false]);
    expect(hits[3].retryAfterMs).toBeGreaterThan(0);
    expect(hits[0].remaining).toBe(2);
    // another user has their own budget, and so does another bucket
    expect((await t.withIdentity(EDITOR).mutation(api.usage.consume, { bucket: "ai", limit: 3, windowMs: 60_000 })).allowed).toBe(true);
    expect((await as.mutation(api.usage.consume, { bucket: "other", limit: 3, windowMs: 60_000 })).allowed).toBe(true);
    await expect(t.mutation(api.usage.consume, { bucket: "ai", limit: 3, windowMs: 60_000 })).rejects.toThrow(/Unauthenticated/);
  });

  it("starts a fresh window once the old one has expired", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(OWNER);
    await as.mutation(api.usage.consume, { bucket: "ai", limit: 1, windowMs: 1000 });
    expect((await as.mutation(api.usage.consume, { bucket: "ai", limit: 1, windowMs: 1000 })).allowed).toBe(false);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("rateLimits").first();
      await ctx.db.patch(row!._id, { windowStart: Date.now() - 5000 });
    });
    expect((await as.mutation(api.usage.consume, { bucket: "ai", limit: 1, windowMs: 1000 })).allowed).toBe(true);
  });
});

describe("uploads", () => {
  it("only editors can upload, and uploads without an image content type are rejected and deleted", async () => {
    const { t, slateId } = await setup();
    await expect(t.withIdentity(VIEWER).mutation(api.files.generateUploadUrl, { slateId })).rejects.toThrow();
    expect(typeof (await t.withIdentity(EDITOR).mutation(api.files.generateUploadUrl, { slateId }))).toBe("string");

    // convex-test's in-memory storage does not record a content type (real Convex takes it from the
    // upload request's Content-Type header, which the client always sets), so this exercises the
    // rejection path: anything that is not positively identified as an image is refused.
    const blob = await t.run((ctx) => ctx.storage.store(new Blob(["hello"], { type: "text/plain" })));
    const res = await t.withIdentity(EDITOR).mutation(api.files.finalizeImage, { slateId, storageId: blob });
    expect(res).toEqual({ ok: false, error: "Only image files can be uploaded" });
    // the rejected file is really gone (the rejection is returned, not thrown, so the delete commits)
    expect(await t.run((ctx) => ctx.storage.getUrl(blob))).toBeNull();
    await expect(t.withIdentity(VIEWER).mutation(api.files.finalizeImage, { slateId, storageId: blob })).rejects.toThrow();
  });
});
