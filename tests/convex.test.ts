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

/* ------------------------------------------------------------------ comments */

const POINT = { kind: "point" as const, x: 120, y: 80 };

async function withProfiles(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    for (const [u, first, last] of [
      [OWNER, "Olivia", "Owner"],
      [EDITOR, "Eddie", "Editor"],
      [VIEWER, "Vera", "Viewer"],
    ] as const) {
      await ctx.db.insert("users", { clerkId: u.subject, email: u.email, firstName: first, lastName: last, imageUrl: null });
    }
  });
}

describe("comments", () => {
  it("creates a thread with its first message and lists it with unread state per person", async () => {
    const { t, slateId } = await setup();
    const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "  Can we split this service?  ", mentions: [] });

    const asOwner = await t.withIdentity(OWNER).query(api.comments.list, { slateId });
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0]).toMatchObject({ id: threadId, anchor: POINT, status: "open", snippet: "Can we split this service?", replyCount: 0, authorName: "Editor", unread: true, mentionsMe: false });
    // your own post is never unread for you
    expect((await t.withIdentity(EDITOR).query(api.comments.list, { slateId }))[0].unread).toBe(false);

    const msgs = await t.withIdentity(OWNER).query(api.comments.messages, { threadId });
    expect(msgs.map((m) => m.body)).toEqual(["Can we split this service?"]);

    await t.withIdentity(OWNER).mutation(api.comments.markRead, { threadId });
    expect((await t.withIdentity(OWNER).query(api.comments.list, { slateId }))[0].unread).toBe(false);

    // a reply makes it unread again for the other person only
    await t.withIdentity(OWNER).mutation(api.comments.reply, { threadId, body: "Yes, good idea", mentions: [] });
    const after = await t.withIdentity(EDITOR).query(api.comments.list, { slateId });
    expect(after[0]).toMatchObject({ replyCount: 1, unread: true });
    expect((await t.withIdentity(OWNER).query(api.comments.list, { slateId }))[0].unread).toBe(false);
    expect((await t.withIdentity(EDITOR).query(api.comments.messages, { threadId })).map((m) => m.body)).toEqual(["Can we split this service?", "Yes, good idea"]);
  });

  it("pins to an element with a fraction of its size so it can follow the element", async () => {
    const { t, slateId } = await setup();
    const anchor = { kind: "element" as const, eid: "box-1", u: 0.25, v: 1.7, x: 40, y: 50 };
    await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor, body: "here", mentions: [] });
    const [thread] = await t.withIdentity(EDITOR).query(api.comments.list, { slateId });
    expect(thread.anchor).toEqual({ kind: "element", eid: "box-1", u: 0.25, v: 1, x: 40, y: 50 }); // v clamped to 0..1
    await expect(
      t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: Number.NaN, y: 1 }, body: "x", mentions: [] })
    ).rejects.toThrow(/position/);
  });

  it("markAllRead clears every unread thread", async () => {
    const { t, slateId } = await setup();
    for (let i = 0; i < 3; i++) await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: `thread ${i}`, mentions: [] });
    const owner = t.withIdentity(OWNER);
    expect((await owner.query(api.comments.list, { slateId })).filter((c) => c.unread)).toHaveLength(3);
    await owner.mutation(api.comments.markAllRead, { slateId });
    expect((await owner.query(api.comments.list, { slateId })).filter((c) => c.unread)).toHaveLength(0);
    // anonymous visitors have no read state and are silently ignored
    await t.mutation(api.comments.markAllRead, { slateId });
  });

  it("resolves, reopens, and reopens automatically when someone replies", async () => {
    const { t, slateId } = await setup();
    const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "todo", mentions: [] });
    await t.withIdentity(VIEWER).mutation(api.comments.setResolved, { threadId, resolved: true });
    let [c] = await t.withIdentity(OWNER).query(api.comments.list, { slateId });
    expect(c).toMatchObject({ status: "resolved", resolvedByName: "Viewer" });
    expect(c.resolvedAt).toBeGreaterThan(0);
    await t.withIdentity(OWNER).mutation(api.comments.setResolved, { threadId, resolved: false });
    [c] = await t.withIdentity(OWNER).query(api.comments.list, { slateId });
    expect(c.status).toBe("open");
    expect(c.resolvedAt).toBeUndefined();
    await t.withIdentity(OWNER).mutation(api.comments.setResolved, { threadId, resolved: true });
    await t.withIdentity(EDITOR).mutation(api.comments.reply, { threadId, body: "still broken", mentions: [] });
    [c] = await t.withIdentity(OWNER).query(api.comments.list, { slateId });
    expect(c.status).toBe("open");
  });

  describe("access", () => {
    it("lets every workspace member comment, including Viewers; strangers see nothing and cannot write", async () => {
      const { t, slateId } = await setup();
      const viewer = t.withIdentity(VIEWER);
      const threadId = await viewer.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "from a viewer", mentions: [] });
      await viewer.mutation(api.comments.reply, { threadId, body: "and a reply", mentions: [] });

      const stranger = t.withIdentity(STRANGER);
      expect(await stranger.query(api.comments.list, { slateId })).toEqual([]);
      expect(await stranger.query(api.comments.messages, { threadId })).toEqual([]);
      expect(await stranger.query(api.comments.members, { slateId })).toEqual([]);
      await expect(stranger.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "hi", mentions: [] })).rejects.toThrow();
      await expect(stranger.mutation(api.comments.reply, { threadId, body: "hi", mentions: [] })).rejects.toThrow();
      await expect(stranger.mutation(api.comments.setResolved, { threadId, resolved: true })).rejects.toThrow();
    });

    it("view links are read-only for comments; edit links let signed-in visitors comment; anonymous never can", async () => {
      const { t, slateId } = await setup();
      const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "internal note", mentions: [] });
      const stranger = t.withIdentity(STRANGER);

      await t.withIdentity(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
      // anyone who can view the board can read its discussion...
      expect(await t.query(api.comments.list, { slateId })).toHaveLength(1);
      expect(await stranger.query(api.comments.messages, { threadId })).toHaveLength(1);
      const viaLink = await stranger.query(api.slates.getById, { id: slateId });
      expect(viaLink).toMatchObject({ access: "view", canComment: false, canModerate: false, canViewHistory: false });
      // ...but only members (or signed-in people on an edit link) can write
      await expect(stranger.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "hi", mentions: [] })).rejects.toThrow(/can't comment/);
      await expect(stranger.mutation(api.comments.reply, { threadId, body: "hi", mentions: [] })).rejects.toThrow(/can't comment/);
      expect(await stranger.query(api.comments.members, { slateId })).toEqual([]);
      // anonymous visitors have no read markers
      expect((await t.query(api.comments.list, { slateId }))[0].unread).toBe(false);

      await t.withIdentity(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" });
      expect((await stranger.query(api.slates.getById, { id: slateId }))?.canComment).toBe(true);
      await stranger.mutation(api.comments.reply, { threadId, body: "link editor here", mentions: [] });
      await expect(t.mutation(api.comments.reply, { threadId, body: "anon", mentions: [] })).rejects.toThrow(/Sign in/);
      await expect(t.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "anon", mentions: [] })).rejects.toThrow();
      // a link editor still cannot moderate other people's comments
      await expect(stranger.mutation(api.comments.deleteThread, { threadId })).rejects.toThrow(/only delete threads you started/);
    });

    it("returns empty instead of throwing once access is revoked mid-session", async () => {
      const { t, slateId } = await setup();
      const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "hi", mentions: [] });
      await t.run(async (ctx) => {
        const m = await ctx.db.query("workspace_members").filter((q) => q.eq(q.field("userId"), EDITOR.subject)).unique();
        await ctx.db.delete(m!._id);
      });
      expect(await t.withIdentity(EDITOR).query(api.comments.list, { slateId })).toEqual([]);
      expect(await t.withIdentity(EDITOR).query(api.comments.messages, { threadId })).toEqual([]);
      await t.withIdentity(OWNER).mutation(api.slates.remove, { id: slateId });
      expect(await t.withIdentity(OWNER).query(api.comments.list, { slateId })).toEqual([]);
    });
  });

  describe("@mentions", () => {
    it("offers teammates (without emails or yourself) and only keeps real members", async () => {
      const { t, slateId } = await setup();
      await withProfiles(t);
      const members = await t.withIdentity(EDITOR).query(api.comments.members, { slateId });
      expect(members.map((m) => m.name)).toEqual(["Olivia Owner", "Vera Viewer"]);
      expect(JSON.stringify(members)).not.toContain("@example.com");

      const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, {
        slateId,
        anchor: POINT,
        body: "@Olivia Owner please review, cc @Vera Viewer",
        mentions: [OWNER.subject, VIEWER.subject, STRANGER.subject, EDITOR.subject, OWNER.subject, "made-up"],
      });
      const [msg] = await t.withIdentity(OWNER).query(api.comments.messages, { threadId });
      // strangers, yourself, unknown ids and duplicates are dropped; names come from the server
      expect(msg.mentions).toEqual([
        { userId: OWNER.subject, name: "Olivia Owner" },
        { userId: VIEWER.subject, name: "Vera Viewer" },
      ]);
      const asOwner = (await t.withIdentity(OWNER).query(api.comments.list, { slateId }))[0];
      const asEditor = (await t.withIdentity(EDITOR).query(api.comments.list, { slateId }))[0];
      expect(asOwner.mentionsMe).toBe(true);
      expect(asEditor.mentionsMe).toBe(false);
    });
  });

  describe("editing and deleting", () => {
    it("authors edit their own messages (mentions recomputed); nobody edits someone else's", async () => {
      const { t, slateId } = await setup();
      await withProfiles(t);
      const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "first", mentions: [] });
      const [first] = await t.withIdentity(EDITOR).query(api.comments.messages, { threadId });
      await expect(t.withIdentity(OWNER).mutation(api.comments.editMessage, { messageId: first.id, body: "hijack", mentions: [] })).rejects.toThrow(/own comments/);
      await t.withIdentity(EDITOR).mutation(api.comments.editMessage, { messageId: first.id, body: "now with @Vera Viewer", mentions: [VIEWER.subject] });
      const [edited] = await t.withIdentity(EDITOR).query(api.comments.messages, { threadId });
      expect(edited).toMatchObject({ body: "now with @Vera Viewer", mentions: [{ userId: VIEWER.subject, name: "Vera Viewer" }] });
      expect(edited.editedAt).toBeGreaterThan(0);
      const [thread] = await t.withIdentity(VIEWER).query(api.comments.list, { slateId });
      expect(thread.snippet).toBe("now with @Vera Viewer");
      expect(thread.mentionsMe).toBe(true);
      await expect(t.withIdentity(EDITOR).mutation(api.comments.editMessage, { messageId: first.id, body: "  ", mentions: [] })).rejects.toThrow(/empty/);
    });

    it("authors delete their replies, moderators delete anyone's, the opening message needs deleteThread", async () => {
      const { t, slateId } = await setup();
      const threadId = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "root", mentions: [] });
      await t.withIdentity(VIEWER).mutation(api.comments.reply, { threadId, body: "viewer reply", mentions: [] });
      await t.withIdentity(OWNER).mutation(api.comments.reply, { threadId, body: "owner reply", mentions: [] });
      const msgs = await t.withIdentity(OWNER).query(api.comments.messages, { threadId });
      const [root, viewerReply, ownerReply] = msgs;

      await expect(t.withIdentity(EDITOR).mutation(api.comments.deleteMessage, { messageId: root.id })).rejects.toThrow(/whole thread/);
      // a Viewer is not a moderator and can't delete the owner's reply
      await expect(t.withIdentity(VIEWER).mutation(api.comments.deleteMessage, { messageId: ownerReply.id })).rejects.toThrow(/own comments/);
      await t.withIdentity(VIEWER).mutation(api.comments.deleteMessage, { messageId: viewerReply.id });
      // an editor member moderates, even other people's replies
      await t.withIdentity(EDITOR).mutation(api.comments.deleteMessage, { messageId: ownerReply.id });
      expect((await t.withIdentity(OWNER).query(api.comments.messages, { threadId })).map((m) => m.body)).toEqual(["root"]);
      expect((await t.withIdentity(OWNER).query(api.comments.list, { slateId }))[0].replyCount).toBe(0);
    });

    it("deleteThread removes the thread, its messages and read markers; only its starter or a moderator may", async () => {
      const { t, slateId } = await setup();
      const threadId = await t.withIdentity(VIEWER).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "root", mentions: [] });
      await t.withIdentity(OWNER).mutation(api.comments.reply, { threadId, body: "reply", mentions: [] });
      await t.withIdentity(EDITOR).mutation(api.comments.markRead, { threadId });
      await expect(t.withIdentity(STRANGER).mutation(api.comments.deleteThread, { threadId })).rejects.toThrow();
      const other = await t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "editor's", mentions: [] });
      await expect(t.withIdentity(VIEWER).mutation(api.comments.deleteThread, { threadId: other })).rejects.toThrow(/threads you started/);

      await t.withIdentity(VIEWER).mutation(api.comments.deleteThread, { threadId }); // its starter, although only a Viewer
      await t.withIdentity(OWNER).mutation(api.comments.deleteThread, { threadId: other }); // a moderator
      expect(await t.withIdentity(OWNER).query(api.comments.list, { slateId })).toEqual([]);
      const leftovers = await t.run(async (ctx) => ({
        messages: (await ctx.db.query("comments").collect()).length,
        reads: (await ctx.db.query("commentReads").collect()).length,
      }));
      expect(leftovers).toEqual({ messages: 0, reads: 0 });
      await t.withIdentity(OWNER).mutation(api.comments.deleteThread, { threadId }); // already gone: no-op
    });
  });

  describe("limits", () => {
    it("rejects empty comments and throttles floods", async () => {
      const { t, slateId } = await setup();
      const as = t.withIdentity(EDITOR);
      await expect(as.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "   ", mentions: [] })).rejects.toThrow(/Write a comment/);
      for (let i = 0; i < 20; i++) await as.mutation(api.comments.createThread, { slateId, anchor: POINT, body: `c${i}`, mentions: [] });
      await expect(as.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "one too many", mentions: [] })).rejects.toThrow(/too fast/);
      // someone else is not affected
      await t.withIdentity(OWNER).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "fine", mentions: [] });
    });

    it("caps threads per board and messages per thread", async () => {
      const { t, slateId } = await setup();
      const threadId = await t.run(async (ctx) => {
        let last = null as unknown as Id<"commentThreads">;
        for (let i = 0; i < 500; i++) {
          last = await ctx.db.insert("commentThreads", {
            slateId,
            anchor: { kind: "point", x: 0, y: 0 },
            status: "open",
            authorId: OWNER.subject,
            authorName: "Owner",
            createdAt: i,
            lastActivityAt: i,
            lastActivityBy: OWNER.subject,
            replyCount: i === 499 ? 198 : 0,
            snippet: "s",
            mentionedIds: [],
          });
        }
        return last;
      });
      await expect(t.withIdentity(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "501st", mentions: [] })).rejects.toThrow(/500 comment threads/);
      // the busiest thread has room for exactly one more message
      await t.withIdentity(EDITOR).mutation(api.comments.reply, { threadId, body: "last one", mentions: [] });
      await expect(t.withIdentity(EDITOR).mutation(api.comments.reply, { threadId, body: "overflow", mentions: [] })).rejects.toThrow(/thread is full/);
    });
  });
});
