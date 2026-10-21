import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "@/lib/client/api";
import { MAX_AUTO_VERSIONS, MAX_MANUAL_VERSIONS, parseSnapshot } from "@/lib/canvas/version-snapshot";
import { getCollections, newDocId } from "@/lib/db/mongo";
import { purgeTombstones } from "@/lib/server/elements";
import { looksLikeImage, MAX_IMAGE_BYTES, readImage, storeImage } from "@/lib/server/files";
import { autoSnapshot } from "@/lib/server/versions";
import { takeToken } from "@/lib/server/usage";
import { as, ctxFor, Deferred, EDITOR, OWNER, resetDb, setup, startDb, stopDb, STRANGER, VIEWER } from "./helpers/db";

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const put = (id: string, z = 1, extra: object = {}) => ({ t: "put" as const, id, z, data: JSON.stringify({ id, type: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10, z, ...extra }) });

/** The whole board as a reader would see it. */
async function allRows(slateId: string, who: Parameters<typeof as>[0] = OWNER) {
  return (await as(who).query(api.elements.sync, { slateId })).puts;
}

describe("elements", () => {
  it("stores one row per element and returns them all", async () => {
    const { slateId } = await setup();
    const ops = Array.from({ length: 40 }, (_, i) => put(`e${i}`, i));
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops });
    expect(await allRows(slateId, VIEWER)).toHaveLength(40);
    const c = await getCollections();
    const seqs = (await c.elements.find({ slateId }).toArray()).map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 40 }, (_, i) => i + 1)); // every change got its own number
  });

  it("bumps rev only when something changed and honours deletes", async () => {
    const { slateId } = await setup();
    const editor = as(EDITOR);
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a", 1)] });
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a", 1)] }); // identical
    expect((await allRows(slateId))[0].rev).toBe(1);
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a", 2)] });
    expect((await allRows(slateId))[0].rev).toBe(2);
    await editor.mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "a" }, { t: "del", id: "missing" }] });
    expect(await allRows(slateId)).toHaveLength(0);
  });

  it("collapses repeated ops on one element within a batch (last wins)", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a", 1, { x: 1 }), put("a", 2, { x: 99 }), put("b", 3), { t: "del", id: "b" }] });
    const rows = await allRows(slateId);
    expect(rows.map((r) => r.eid)).toEqual(["a"]);
    expect(rows[0].z).toBe(2);
  });

  it("rejects oversize batches, elements and bad ids", async () => {
    const { slateId } = await setup();
    const editor = as(EDITOR);
    await expect(editor.mutation(api.elements.apply, { slateId, ops: Array.from({ length: 501 }, (_, i) => put(`x${i}`)) })).rejects.toThrow(/Too many/);
    await expect(editor.mutation(api.elements.apply, { slateId, ops: [{ t: "put", id: "big", z: 1, data: "x".repeat(260_000) }] })).rejects.toThrow(/too large/);
    await expect(editor.mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "" }] })).rejects.toThrow(/Invalid element id/);
  });

  it("migrates a legacy board once, only for editors", async () => {
    const { slateId } = await setup();
    const c = await getCollections();
    await c.slates.updateOne({ _id: slateId }, { $set: { elements: JSON.stringify([{ id: "old" }]), schemaVersion: 1 } });
    const meta = await as(VIEWER).query(api.slates.getById, { id: slateId });
    expect(meta?.hasLegacyElements).toBe(true);
    expect((await as(VIEWER).query(api.slates.getDocument, { id: slateId }))?.legacyElements).toContain("old");
    await expect(as(VIEWER).mutation(api.elements.importLegacy, { slateId, ops: [put("m1")] })).rejects.toThrow();
    const r1 = await as(EDITOR).mutation(api.elements.importLegacy, { slateId, ops: [put("m1"), put("m2")] });
    expect(r1.imported).toBe(2);
    expect((await as(EDITOR).query(api.slates.getById, { id: slateId }))?.hasLegacyElements).toBe(false);
    expect((await as(EDITOR).query(api.slates.getDocument, { id: slateId }))?.legacyElements).toBeUndefined();
    const r2 = await as(EDITOR).mutation(api.elements.importLegacy, { slateId, ops: [put("m3")] });
    expect(r2.imported).toBe(0);
    expect(await allRows(slateId)).toHaveLength(2);
  });
});

describe("change feed (elements.sync)", () => {
  it("sends only what changed since the last cursor", async () => {
    const { slateId } = await setup();
    const editor = as(EDITOR);
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a"), put("b")] });
    const first = await as(OWNER).query(api.elements.sync, { slateId });
    expect(first.full).toBe(true);
    expect(first.puts.map((p) => p.eid).sort()).toEqual(["a", "b"]);

    // nothing happened: an empty delta (rows from the last few seconds are re-sent on purpose, see below)
    const c = await getCollections();
    await c.elements.updateMany({ slateId }, { $set: { updatedAt: 1 } }); // pretend the writes are old
    const idle = await as(OWNER).query(api.elements.sync, { slateId, since: first.cursor });
    expect(idle).toMatchObject({ full: false, puts: [], dels: [], cursor: first.cursor });

    await editor.mutation(api.elements.apply, { slateId, ops: [put("b", 5), { t: "del", id: "a" }, put("c")] });
    await c.elements.updateMany({ slateId, seq: { $lte: first.cursor } }, { $set: { updatedAt: 1 } });
    const delta = await as(OWNER).query(api.elements.sync, { slateId, since: first.cursor });
    expect(delta.full).toBe(false);
    expect(delta.puts.map((p) => p.eid).sort()).toEqual(["b", "c"]);
    expect(delta.dels).toEqual(["a"]);
    expect(delta.cursor).toBeGreaterThan(first.cursor);
  });

  it("re-sends very recent rows so a late writer is never missed", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    const c = await getCollections();
    const cursor = (await as(OWNER).query(api.elements.sync, { slateId })).cursor;
    // a write that got a lower number than the reader's cursor but became visible only now
    await c.elements.insertOne({ _id: newDocId(), slateId, eid: "late", seq: cursor - 1, z: 1, rev: 1, data: "{}", updatedAt: Date.now() });
    const res = await as(OWNER).query(api.elements.sync, { slateId, since: cursor });
    expect(res.puts.map((p) => p.eid)).toContain("late");
  });

  it("keeps delete markers for a while, then asks long-absent clients to reload the whole board", async () => {
    const { slateId } = await setup();
    const editor = as(EDITOR);
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a"), put("b")] });
    const away = (await as(OWNER).query(api.elements.sync, { slateId })).cursor;
    await editor.mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "a" }] });
    const c = await getCollections();
    expect(await c.elements.countDocuments({ slateId, deleted: true })).toBe(1); // still there for clients to learn about

    // markers older than the keep-time are purged, and the board remembers how far
    expect(await purgeTombstones(slateId, Date.now() + 1000)).toBe(1);
    expect(await c.elements.countDocuments({ slateId, deleted: true })).toBe(0);
    const stale = await as(OWNER).query(api.elements.sync, { slateId, since: away });
    expect(stale.full).toBe(true);
    expect(stale.puts.map((p) => p.eid)).toEqual(["b"]);
  });

  it("brings a deleted element back when it is put again", async () => {
    const { slateId } = await setup();
    const editor = as(EDITOR);
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a", 1)] });
    await editor.mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "a" }] });
    await editor.mutation(api.elements.apply, { slateId, ops: [put("a", 1)] });
    const rows = await allRows(slateId);
    expect(rows.map((r) => r.eid)).toEqual(["a"]);
    expect(rows[0].rev).toBe(3);
  });

  it("answers quietly (no change, no error) when access is gone", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    expect(await as(STRANGER).query(api.elements.sync, { slateId, since: 7 })).toEqual({ full: false, cursor: 7, puts: [], dels: [] });
  });
});

describe("access control", () => {
  it("viewers can read but not write; strangers can't even read", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    expect(await allRows(slateId, VIEWER)).toHaveLength(1);
    await expect(as(VIEWER).mutation(api.elements.apply, { slateId, ops: [put("b")] })).rejects.toThrow(/view access/);
    expect(await allRows(slateId, STRANGER)).toHaveLength(0);
    expect(await as(STRANGER).query(api.slates.getById, { id: slateId })).toBeNull();
    expect(await as(null).query(api.slates.getById, { id: slateId })).toBeNull();
    await expect(as(STRANGER).mutation(api.elements.apply, { slateId, ops: [put("c")] })).rejects.toThrow();
  });

  it("link sharing: view opens it to everyone, edit lets signed-in users write", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });

    // only workspace members can change sharing
    await expect(as(STRANGER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" })).rejects.toThrow();

    await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
    const anon = await as(null).query(api.slates.getById, { id: slateId });
    expect(anon?.access).toBe("view");
    expect(anon?.canManage).toBe(false);
    expect(await allRows(slateId, null)).toHaveLength(1);
    await expect(as(STRANGER).mutation(api.elements.apply, { slateId, ops: [put("x")] })).rejects.toThrow(/view access/);

    await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" });
    await as(STRANGER).mutation(api.elements.apply, { slateId, ops: [put("by-stranger")] });
    expect((await allRows(slateId)).map((r) => r.eid).sort()).toEqual(["a", "by-stranger"]);
    // anonymous visitors stay read-only even on "edit" links
    await expect(as(null).mutation(api.elements.apply, { slateId, ops: [put("anon")] })).rejects.toThrow();
    // a link editor can't rename or delete the board
    await expect(as(STRANGER).mutation(api.slates.rename, { id: slateId, title: "Hijacked" })).rejects.toThrow(/workspace members/);
    await expect(as(STRANGER).mutation(api.slates.remove, { id: slateId })).rejects.toThrow();
  });

  it("archived slates disappear for everyone", async () => {
    const { slateId } = await setup();
    await as(OWNER).mutation(api.slates.remove, { id: slateId });
    expect(await as(OWNER).query(api.slates.getById, { id: slateId })).toBeNull();
    expect(await allRows(slateId)).toHaveLength(0);
  });

  it("legacy slates without a workspace stay editable by their original owner only", async () => {
    const c = await getCollections();
    const slateId = newDocId();
    await c.slates.insertOne({ _id: slateId, title: "Old", isArchived: false, createdAt: 1, lastEdited: 1, thumbnailIcon: "1", userId: OWNER.subject });
    expect((await as(OWNER).query(api.slates.getById, { id: slateId }))?.access).toBe("edit");
    expect(await as(STRANGER).query(api.slates.getById, { id: slateId })).toBeNull();
  });

  it("refuses ids that are not plain strings (no query-operator injection)", async () => {
    await setup();
    const evil = { $ne: "" } as unknown as string;
    await expect(as(OWNER).query(api.slates.getById, { id: evil })).rejects.toThrow(/Invalid request/);
    await expect(as(OWNER).query(api.elements.sync, { slateId: evil })).rejects.toThrow(/Invalid request/);
    await expect(as(OWNER).query(api.slates.list, { workspaceId: { $gt: "" } as unknown as string })).rejects.toThrow(/Invalid request/);
  });
});

describe("slate lists", () => {
  it("returns lightweight summaries newest first and hides archived ones", async () => {
    const { workspaceId } = await setup();
    const owner = as(OWNER);
    const a = await owner.mutation(api.slates.create, { title: "A", workspaceId, thumbnailIcon: "1" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await owner.mutation(api.slates.create, { title: "B", workspaceId, thumbnailIcon: "2" });
    await owner.mutation(api.slates.remove, { id: a });
    const list = await owner.query(api.slates.list, { workspaceId });
    expect(list.map((s) => s.title)).toEqual(["B", "Board"]);
    expect(list[0]._id).toBe(b);
    expect(Object.keys(list[0])).not.toContain("elements");
    expect(Object.keys(list[0])).not.toContain("documentText");
    await expect(as(VIEWER).mutation(api.slates.create, { title: "X", workspaceId, thumbnailIcon: "1" })).rejects.toThrow();
  });

  it("keeps the document out of the polled metadata and serves it separately", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.slates.updateDocument, { id: slateId, documentText: "# Hello", documentJson: '{"type":"doc"}' });
    const meta = await as(VIEWER).query(api.slates.getById, { id: slateId });
    expect(JSON.stringify(meta)).not.toContain("Hello");
    expect(await as(VIEWER).query(api.slates.getDocument, { id: slateId })).toMatchObject({ documentText: "# Hello", documentJson: '{"type":"doc"}' });
    expect(await as(STRANGER).query(api.slates.getDocument, { id: slateId })).toBeNull();
    await expect(as(VIEWER).mutation(api.slates.updateDocument, { id: slateId, documentText: "x" })).rejects.toThrow(/view access/);
    await expect(as(EDITOR).mutation(api.slates.updateDocument, { id: slateId, documentText: "x".repeat(900_001) })).rejects.toThrow(/too large/);
  });
});

describe("presence", () => {
  it("joins, updates, lists and leaves", async () => {
    const { slateId } = await setup();
    const editor = as(EDITOR);
    const id = await editor.mutation(api.presence.join, { slateId, sessionId: "tab1", name: "Ed", color: "#ff0000" });
    const again = await editor.mutation(api.presence.join, { slateId, sessionId: "tab1", name: "Ed R.", color: "#ff0000" });
    expect(again).toEqual(id); // re-joining the same tab reuses the row
    expect(await editor.mutation(api.presence.update, { id, cursor: { x: 10.5, y: -4 }, selection: ["a", "b"], tool: "select" })).toBe(true);
    const peers = await as(OWNER).query(api.presence.list, { slateId });
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ name: "Ed R.", cursor: { x: 10.5, y: -4 }, selection: ["a", "b"] });
    await editor.mutation(api.presence.leave, { id });
    expect(await as(OWNER).query(api.presence.list, { slateId })).toHaveLength(0);
    // updating a removed row reports false so the client can re-join
    expect(await editor.mutation(api.presence.update, { id, cursor: null, selection: [] })).toBe(false);
  });

  it("keeps strangers out and sanitises input", async () => {
    const { slateId } = await setup();
    await expect(as(STRANGER).mutation(api.presence.join, { slateId, sessionId: "x", name: "Eve", color: "#000000" })).rejects.toThrow();
    await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
    const anon = as(null);
    const id = await anon.mutation(api.presence.join, { slateId, sessionId: "anon1", name: "  " + "x".repeat(200), color: "not-a-colour" });
    const [p] = await anon.query(api.presence.list, { slateId });
    expect(p.name.length).toBeLessThanOrEqual(60);
    expect(p.color).toBe("#6366f1");
    expect(p.userId).toBe("anon:anon1");
    await anon.mutation(api.presence.update, { id, cursor: { x: 1e12, y: -1e12 }, selection: Array.from({ length: 500 }, (_, i) => `s${i}`) });
    const [q] = await anon.query(api.presence.list, { slateId });
    expect(q.selection.length).toBeLessThanOrEqual(60);
    expect(Math.abs(q.cursor!.x)).toBeLessThanOrEqual(1e7);
    expect(Math.abs(q.cursor!.y)).toBeLessThanOrEqual(1e7);
  });

  it("stops listing sessions that went quiet, and expires their rows on their own", async () => {
    const { slateId } = await setup();
    const c = await getCollections();
    const row = { slateId, userId: "u", name: "Old", color: "#000000", cursor: null, selection: [] };
    await c.liveSessions.insertOne({ _id: "old", sessionId: "old", lastSeen: Date.now() - 10 * 60_000, expireAt: new Date(Date.now() - 1000), ...row });
    await c.liveSessions.insertOne({ _id: "new", sessionId: "new", lastSeen: Date.now(), expireAt: new Date(Date.now() + 60_000), ...row, name: "New" });
    expect((await as(OWNER).query(api.presence.list, { slateId })).map((s) => s.sessionId)).toEqual(["new"]);
    const indexes = await c.liveSessions.indexes();
    expect(indexes.some((i) => i.key.expireAt === 1 && i.expireAfterSeconds === 0)).toBe(true); // MongoDB's TTL monitor deletes the old row
  });

  it("shows who else is on the boards of the dashboard, never yourself", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.presence.join, { slateId, sessionId: "e1", name: "Ed", color: "#112233" });
    await as(OWNER).mutation(api.presence.join, { slateId, sessionId: "o1", name: "Olive", color: "#445566" });
    const seenByOwner = await as(OWNER).query(api.presence.activeOnSlates, { slateIds: [slateId] });
    expect(seenByOwner).toEqual([{ slateId, count: 1, people: [{ name: "Ed", avatar: null, color: "#112233" }] }]);
    expect(await as(STRANGER).query(api.presence.activeOnSlates, { slateIds: [slateId] })).toEqual([]);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit per user per window, then blocks with a retry time", async () => {
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await takeToken(OWNER.subject, "ai", 3, 60_000));
    expect(hits.map((h) => h.allowed)).toEqual([true, true, true, false]);
    expect(hits[3].retryAfterMs).toBeGreaterThan(0);
    expect(hits[0].remaining).toBe(2);
    // another user has their own budget, and so does another bucket
    expect((await takeToken(EDITOR.subject, "ai", 3, 60_000)).allowed).toBe(true);
    expect((await takeToken(OWNER.subject, "other", 3, 60_000)).allowed).toBe(true);
  });

  it("is atomic: a burst of parallel requests never gets more than the limit through", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => takeToken(OWNER.subject, "burst", 10, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("starts a fresh window once the old one has expired", async () => {
    await takeToken(OWNER.subject, "ai", 1, 1000);
    expect((await takeToken(OWNER.subject, "ai", 1, 1000)).allowed).toBe(false);
    const c = await getCollections();
    await c.rateLimits.updateOne({ _id: `${OWNER.subject}:ai` }, { $set: { windowStart: Date.now() - 5000 } });
    expect((await takeToken(OWNER.subject, "ai", 1, 1000)).allowed).toBe(true);
  });
});

describe("uploads", () => {
  const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

  it("only editors can upload; the image is stored and served back byte for byte", async () => {
    const { slateId } = await setup();
    await expect(storeImage(ctxFor(VIEWER), slateId, "image/png", PNG)).rejects.toThrow();
    const res = await storeImage(ctxFor(EDITOR), slateId, "image/png", PNG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.url).toMatch(/^\/api\/files\/[0-9a-f]{32}$/);
    const file = await readImage(res.url.split("/").pop()!);
    expect(file?.contentType).toBe("image/png");
    expect(file?.length).toBe(PNG.length);
    const bytes = new Uint8Array(await new Response(file!.stream as unknown as ReadableStream).arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PNG));
  });

  it("refuses anything that is not really an image, and oversize files", async () => {
    const { slateId } = await setup();
    const editor = ctxFor(EDITOR);
    expect(await storeImage(editor, slateId, "text/plain", new TextEncoder().encode("hello"))).toEqual({ ok: false, error: "Only image files can be uploaded" });
    expect(await storeImage(editor, slateId, "image/png", new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toMatchObject({ ok: false }); // claims PNG, isn't
    expect(await storeImage(editor, slateId, "image/png", new Uint8Array(0))).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(await storeImage(editor, slateId, "image/png", big)).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
    expect(await readImage("not-a-real-id")).toBeNull();
    expect(await readImage("0".repeat(32))).toBeNull();
  });

  it("recognises the formats it accepts", () => {
    expect(looksLikeImage("image/svg+xml", new TextEncoder().encode('<?xml version="1.0"?><svg/>'))).toBe(true);
    expect(looksLikeImage("image/svg+xml", new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLikeImage("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeImage("image/gif", new TextEncoder().encode("GIF89a"))).toBe(true);
    expect(looksLikeImage("image/webp", new TextEncoder().encode("RIFF\0\0\0\0WEBP"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ comments */

const POINT = { kind: "point" as const, x: 120, y: 80 };

async function withProfiles() {
  const c = await getCollections();
  for (const [u, first, last] of [
    [OWNER, "Olivia", "Owner"],
    [EDITOR, "Eddie", "Editor"],
    [VIEWER, "Vera", "Viewer"],
  ] as const) {
    await c.users.insertOne({ _id: newDocId(), clerkId: u.subject, email: u.email, firstName: first, lastName: last, imageUrl: null, createdAt: 1 });
  }
}

describe("comments", () => {
  it("creates a thread with its first message and lists it with unread state per person", async () => {
    const { slateId } = await setup();
    const threadId = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "  Can we split this service?  ", mentions: [] });

    const asOwner = await as(OWNER).query(api.comments.list, { slateId });
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0]).toMatchObject({ id: threadId, anchor: POINT, status: "open", snippet: "Can we split this service?", replyCount: 0, authorName: "Editor", unread: true, mentionsMe: false });
    // your own post is never unread for you
    expect((await as(EDITOR).query(api.comments.list, { slateId }))[0].unread).toBe(false);

    const msgs = await as(OWNER).query(api.comments.messages, { threadId });
    expect(msgs.map((m) => m.body)).toEqual(["Can we split this service?"]);

    await as(OWNER).mutation(api.comments.markRead, { threadId });
    expect((await as(OWNER).query(api.comments.list, { slateId }))[0].unread).toBe(false);

    // a reply makes it unread again for the other person only
    await as(OWNER).mutation(api.comments.reply, { threadId, body: "Yes, good idea", mentions: [] });
    const after = await as(EDITOR).query(api.comments.list, { slateId });
    expect(after[0]).toMatchObject({ replyCount: 1, unread: true });
    expect((await as(OWNER).query(api.comments.list, { slateId }))[0].unread).toBe(false);
    expect((await as(EDITOR).query(api.comments.messages, { threadId })).map((m) => m.body)).toEqual(["Can we split this service?", "Yes, good idea"]);
  });

  it("pins to an element with a fraction of its size so it can follow the element", async () => {
    const { slateId } = await setup();
    const anchor = { kind: "element" as const, eid: "box-1", u: 0.25, v: 1.7, x: 40, y: 50 };
    await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor, body: "here", mentions: [] });
    const [thread] = await as(EDITOR).query(api.comments.list, { slateId });
    expect(thread.anchor).toEqual({ kind: "element", eid: "box-1", u: 0.25, v: 1, x: 40, y: 50 }); // v clamped to 0..1
    await expect(as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: { kind: "point", x: Number.NaN, y: 1 }, body: "x", mentions: [] })).rejects.toThrow(/position/);
  });

  it("markAllRead clears every unread thread", async () => {
    const { slateId } = await setup();
    for (let i = 0; i < 3; i++) await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: `thread ${i}`, mentions: [] });
    const owner = as(OWNER);
    expect((await owner.query(api.comments.list, { slateId })).filter((c) => c.unread)).toHaveLength(3);
    await owner.mutation(api.comments.markAllRead, { slateId });
    expect((await owner.query(api.comments.list, { slateId })).filter((c) => c.unread)).toHaveLength(0);
    // anonymous visitors have no read state and are silently ignored
    await as(null).mutation(api.comments.markAllRead, { slateId });
  });

  it("resolves, reopens, and reopens automatically when someone replies", async () => {
    const { slateId } = await setup();
    const threadId = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "todo", mentions: [] });
    await as(VIEWER).mutation(api.comments.setResolved, { threadId, resolved: true });
    let [c] = await as(OWNER).query(api.comments.list, { slateId });
    expect(c).toMatchObject({ status: "resolved", resolvedByName: "Viewer" });
    expect(c.resolvedAt).toBeGreaterThan(0);
    await as(OWNER).mutation(api.comments.setResolved, { threadId, resolved: false });
    [c] = await as(OWNER).query(api.comments.list, { slateId });
    expect(c.status).toBe("open");
    expect(c.resolvedAt).toBeUndefined();
    await as(OWNER).mutation(api.comments.setResolved, { threadId, resolved: true });
    await as(EDITOR).mutation(api.comments.reply, { threadId, body: "still broken", mentions: [] });
    [c] = await as(OWNER).query(api.comments.list, { slateId });
    expect(c.status).toBe("open");
    expect(c.resolvedAt).toBeUndefined();
  });

  describe("access", () => {
    it("lets every workspace member comment, including Viewers; strangers see nothing and cannot write", async () => {
      const { slateId } = await setup();
      const viewer = as(VIEWER);
      const threadId = await viewer.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "from a viewer", mentions: [] });
      await viewer.mutation(api.comments.reply, { threadId, body: "and a reply", mentions: [] });

      const stranger = as(STRANGER);
      expect(await stranger.query(api.comments.list, { slateId })).toEqual([]);
      expect(await stranger.query(api.comments.messages, { threadId })).toEqual([]);
      expect(await stranger.query(api.comments.members, { slateId })).toEqual([]);
      await expect(stranger.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "hi", mentions: [] })).rejects.toThrow();
      await expect(stranger.mutation(api.comments.reply, { threadId, body: "hi", mentions: [] })).rejects.toThrow();
      await expect(stranger.mutation(api.comments.setResolved, { threadId, resolved: true })).rejects.toThrow();
    });

    it("view links are read-only for comments; edit links let signed-in visitors comment; anonymous never can", async () => {
      const { slateId } = await setup();
      const threadId = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "internal note", mentions: [] });
      const stranger = as(STRANGER);
      const anon = as(null);

      await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
      // anyone who can view the board can read its discussion...
      expect(await anon.query(api.comments.list, { slateId })).toHaveLength(1);
      expect(await stranger.query(api.comments.messages, { threadId })).toHaveLength(1);
      const viaLink = await stranger.query(api.slates.getById, { id: slateId });
      expect(viaLink).toMatchObject({ access: "view", canComment: false, canModerate: false, canViewHistory: false });
      // ...but only members (or signed-in people on an edit link) can write
      await expect(stranger.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "hi", mentions: [] })).rejects.toThrow(/can't comment/);
      await expect(stranger.mutation(api.comments.reply, { threadId, body: "hi", mentions: [] })).rejects.toThrow(/can't comment/);
      expect(await stranger.query(api.comments.members, { slateId })).toEqual([]);
      // anonymous visitors have no read markers
      expect((await anon.query(api.comments.list, { slateId }))[0].unread).toBe(false);

      await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" });
      expect((await stranger.query(api.slates.getById, { id: slateId }))?.canComment).toBe(true);
      await stranger.mutation(api.comments.reply, { threadId, body: "link editor here", mentions: [] });
      await expect(anon.mutation(api.comments.reply, { threadId, body: "anon", mentions: [] })).rejects.toThrow(/Sign in/);
      await expect(anon.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "anon", mentions: [] })).rejects.toThrow();
      // a link editor still cannot moderate other people's comments
      await expect(stranger.mutation(api.comments.deleteThread, { threadId })).rejects.toThrow(/only delete threads you started/);
    });

    it("returns empty instead of throwing once access is revoked mid-session", async () => {
      const { slateId } = await setup();
      const threadId = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "hi", mentions: [] });
      const c = await getCollections();
      await c.workspaceMembers.deleteOne({ userId: EDITOR.subject });
      expect(await as(EDITOR).query(api.comments.list, { slateId })).toEqual([]);
      expect(await as(EDITOR).query(api.comments.messages, { threadId })).toEqual([]);
      await as(OWNER).mutation(api.slates.remove, { id: slateId });
      expect(await as(OWNER).query(api.comments.list, { slateId })).toEqual([]);
    });
  });

  describe("@mentions", () => {
    it("offers teammates (without emails or yourself) and only keeps real members", async () => {
      const { slateId } = await setup();
      await withProfiles();
      const members = await as(EDITOR).query(api.comments.members, { slateId });
      expect(members.map((m) => m.name)).toEqual(["Olivia Owner", "Vera Viewer"]);
      expect(JSON.stringify(members)).not.toContain("@example.com");

      const threadId = await as(EDITOR).mutation(api.comments.createThread, {
        slateId,
        anchor: POINT,
        body: "@Olivia Owner please review, cc @Vera Viewer",
        mentions: [OWNER.subject, VIEWER.subject, STRANGER.subject, EDITOR.subject, OWNER.subject, "made-up"],
      });
      const [msg] = await as(OWNER).query(api.comments.messages, { threadId });
      // strangers, yourself, unknown ids and duplicates are dropped; names come from the server
      expect(msg.mentions).toEqual([
        { userId: OWNER.subject, name: "Olivia Owner" },
        { userId: VIEWER.subject, name: "Vera Viewer" },
      ]);
      const asOwner = (await as(OWNER).query(api.comments.list, { slateId }))[0];
      const asEditor = (await as(EDITOR).query(api.comments.list, { slateId }))[0];
      expect(asOwner.mentionsMe).toBe(true);
      expect(asEditor.mentionsMe).toBe(false);
    });
  });

  describe("editing and deleting", () => {
    it("authors edit their own messages (mentions recomputed); nobody edits someone else's", async () => {
      const { slateId } = await setup();
      await withProfiles();
      const threadId = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "first", mentions: [] });
      const [first] = await as(EDITOR).query(api.comments.messages, { threadId });
      await expect(as(OWNER).mutation(api.comments.editMessage, { messageId: first.id, body: "hijack", mentions: [] })).rejects.toThrow(/own comments/);
      await as(EDITOR).mutation(api.comments.editMessage, { messageId: first.id, body: "now with @Vera Viewer", mentions: [VIEWER.subject] });
      const [edited] = await as(EDITOR).query(api.comments.messages, { threadId });
      expect(edited).toMatchObject({ body: "now with @Vera Viewer", mentions: [{ userId: VIEWER.subject, name: "Vera Viewer" }] });
      expect(edited.editedAt).toBeGreaterThan(0);
      const [thread] = await as(VIEWER).query(api.comments.list, { slateId });
      expect(thread.snippet).toBe("now with @Vera Viewer");
      expect(thread.mentionsMe).toBe(true);
      await expect(as(EDITOR).mutation(api.comments.editMessage, { messageId: first.id, body: "  ", mentions: [] })).rejects.toThrow(/empty/);
    });

    it("authors delete their replies, moderators delete anyone's, the opening message needs deleteThread", async () => {
      const { slateId } = await setup();
      const threadId = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "root", mentions: [] });
      await as(VIEWER).mutation(api.comments.reply, { threadId, body: "viewer reply", mentions: [] });
      await as(OWNER).mutation(api.comments.reply, { threadId, body: "owner reply", mentions: [] });
      const [root, viewerReply, ownerReply] = await as(OWNER).query(api.comments.messages, { threadId });

      await expect(as(EDITOR).mutation(api.comments.deleteMessage, { messageId: root.id })).rejects.toThrow(/whole thread/);
      // a Viewer is not a moderator and can't delete the owner's reply
      await expect(as(VIEWER).mutation(api.comments.deleteMessage, { messageId: ownerReply.id })).rejects.toThrow(/own comments/);
      await as(VIEWER).mutation(api.comments.deleteMessage, { messageId: viewerReply.id });
      // an editor member moderates, even other people's replies
      await as(EDITOR).mutation(api.comments.deleteMessage, { messageId: ownerReply.id });
      expect((await as(OWNER).query(api.comments.messages, { threadId })).map((m) => m.body)).toEqual(["root"]);
      expect((await as(OWNER).query(api.comments.list, { slateId }))[0].replyCount).toBe(0);
    });

    it("deleteThread removes the thread, its messages and read markers; only its starter or a moderator may", async () => {
      const { slateId } = await setup();
      const threadId = await as(VIEWER).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "root", mentions: [] });
      await as(OWNER).mutation(api.comments.reply, { threadId, body: "reply", mentions: [] });
      await as(EDITOR).mutation(api.comments.markRead, { threadId });
      await expect(as(STRANGER).mutation(api.comments.deleteThread, { threadId })).rejects.toThrow();
      const other = await as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "editor's", mentions: [] });
      await expect(as(VIEWER).mutation(api.comments.deleteThread, { threadId: other })).rejects.toThrow(/threads you started/);

      await as(VIEWER).mutation(api.comments.deleteThread, { threadId }); // its starter, although only a Viewer
      await as(OWNER).mutation(api.comments.deleteThread, { threadId: other }); // a moderator
      expect(await as(OWNER).query(api.comments.list, { slateId })).toEqual([]);
      const c = await getCollections();
      expect({ messages: await c.comments.countDocuments(), reads: await c.commentReads.countDocuments() }).toEqual({ messages: 0, reads: 0 });
      await as(OWNER).mutation(api.comments.deleteThread, { threadId }); // already gone: no-op
    });
  });

  describe("limits", () => {
    it("rejects empty comments and throttles floods", async () => {
      const { slateId } = await setup();
      const editor = as(EDITOR);
      await expect(editor.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "   ", mentions: [] })).rejects.toThrow(/Write a comment/);
      for (let i = 0; i < 20; i++) await editor.mutation(api.comments.createThread, { slateId, anchor: POINT, body: `c${i}`, mentions: [] });
      await expect(editor.mutation(api.comments.createThread, { slateId, anchor: POINT, body: "one too many", mentions: [] })).rejects.toThrow(/too fast/);
      // someone else is not affected
      await as(OWNER).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "fine", mentions: [] });
    });

    it("caps threads per board and messages per thread", async () => {
      const { slateId } = await setup();
      const c = await getCollections();
      const ids = Array.from({ length: 500 }, () => newDocId());
      await c.commentThreads.insertMany(
        ids.map((_id, i) => ({
          _id,
          slateId,
          anchor: { kind: "point" as const, x: 0, y: 0 },
          status: "open" as const,
          authorId: OWNER.subject,
          authorName: "Owner",
          createdAt: i,
          lastActivityAt: i,
          lastActivityBy: OWNER.subject,
          replyCount: i === 499 ? 198 : 0,
          snippet: "s",
          mentionedIds: [],
        }))
      );
      await expect(as(EDITOR).mutation(api.comments.createThread, { slateId, anchor: POINT, body: "501st", mentions: [] })).rejects.toThrow(/500 comment threads/);
      const threadId = ids[499];
      // the busiest thread has room for exactly one more message
      await as(EDITOR).mutation(api.comments.reply, { threadId, body: "last one", mentions: [] });
      await expect(as(EDITOR).mutation(api.comments.reply, { threadId, body: "overflow", mentions: [] })).rejects.toThrow(/thread is full/);
    });
  });
});

/* ------------------------------------------------------------ version history */

const count = async (name: "elements" | "slateVersions" | "versionChunks") => (await getCollections())[name].countDocuments();

describe("version history", () => {
  it("saves a board as one compact snapshot, not a copy of every element row", async () => {
    const { slateId } = await setup();
    const ops = Array.from({ length: 300 }, (_, i) => put(`e${i}`, i, { x: i, text: `node ${i}` }));
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops });

    const out = await as(OWNER).mutation(api.versions.create, { slateId, label: "  Before the redesign " });
    expect(out).toMatchObject({ ok: true, elementCount: 300 });

    // 300 element rows -> 1 version row + a handful of chunk rows, and the element rows are untouched
    expect(await count("slateVersions")).toBe(1);
    expect(await count("versionChunks")).toBeLessThanOrEqual(2);
    expect(await count("elements")).toBe(300);

    const [meta] = await as(VIEWER).query(api.versions.list, { slateId });
    expect(meta).toMatchObject({ kind: "manual", label: "Before the redesign", authorName: "Owner", elementCount: 300 });
    expect(meta.bytes).toBeGreaterThan(1000);

    const full = await as(VIEWER).query(api.versions.get, { versionId: meta.id });
    const els = parseSnapshot(full!.chunks) as { id: string; z: number; x: number; text: string }[];
    expect(els).toHaveLength(300);
    expect(els[0]).toMatchObject({ id: "e0", z: 0, text: "node 0" });
    expect(els.map((e) => e.z)).toEqual([...els.map((e) => e.z)].sort((a, b) => a - b)); // paint order
  });

  it("leaves deleted elements out of a snapshot", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("keep"), put("gone")] });
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "gone" }] });
    expect(await as(OWNER).mutation(api.versions.create, { slateId })).toMatchObject({ ok: true, elementCount: 1 });
  });

  it("splits a large board over several chunks and reads it back byte for byte", async () => {
    const { slateId } = await setup();
    const big = "lorem ipsum dolor sit amet ".repeat(40);
    for (let b = 0; b < 3; b++) {
      const ops = Array.from({ length: 150 }, (_, i) => put(`b${b}-${i}`, b * 150 + i, { text: big }));
      await as(EDITOR).mutation(api.elements.apply, { slateId, ops });
    }
    await as(OWNER).mutation(api.versions.create, { slateId });
    const chunks = await count("versionChunks");
    expect(chunks).toBeGreaterThan(1);
    expect(chunks).toBeLessThan(15);

    const [meta] = await as(OWNER).query(api.versions.list, { slateId });
    const full = await as(OWNER).query(api.versions.get, { versionId: meta.id });
    expect(full!.chunks).toHaveLength(chunks);
    const els = parseSnapshot(full!.chunks) as { id: string; text: string }[];
    expect(els).toHaveLength(450);
    expect(els.every((e) => e.text === big)).toBe(true);
  });

  it("an empty board can be saved by hand (a blank starting point)", async () => {
    const { slateId } = await setup();
    expect(await as(OWNER).mutation(api.versions.create, { slateId, label: "Blank" })).toMatchObject({ ok: true, elementCount: 0 });
    const [meta] = await as(OWNER).query(api.versions.list, { slateId });
    expect(parseSnapshot((await as(OWNER).query(api.versions.get, { versionId: meta.id }))!.chunks)).toEqual([]);
  });

  it("only members can see history; only members with edit rights can save, rename or delete", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    await as(EDITOR).mutation(api.versions.create, { slateId, label: "v1" });
    const [meta] = await as(OWNER).query(api.versions.list, { slateId });

    // workspace Viewers may look (review), but not change anything
    expect(await as(VIEWER).query(api.versions.list, { slateId })).toHaveLength(1);
    expect(await as(VIEWER).query(api.versions.get, { versionId: meta.id })).not.toBeNull();
    await expect(as(VIEWER).mutation(api.versions.create, { slateId, label: "nope" })).rejects.toThrow();
    await expect(as(VIEWER).mutation(api.versions.rename, { versionId: meta.id, label: "nope" })).rejects.toThrow();
    await expect(as(VIEWER).mutation(api.versions.remove, { versionId: meta.id })).rejects.toThrow();

    // strangers and anonymous visitors get nothing, even with a view link
    await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "view" });
    for (const who of [as(STRANGER), as(null)]) {
      expect(await who.query(api.versions.list, { slateId })).toEqual([]);
      expect(await who.query(api.versions.get, { versionId: meta.id })).toBeNull();
    }
    // ...and a link that grants edit lets people change the board but still not manage its history
    await as(OWNER).mutation(api.slates.setLinkAccess, { id: slateId, linkAccess: "edit" });
    expect(await as(STRANGER).query(api.versions.list, { slateId })).toEqual([]);
    await expect(as(STRANGER).mutation(api.versions.create, { slateId })).rejects.toThrow(/workspace members/);
    expect(await as(STRANGER).query(api.slates.getById, { id: slateId })).toMatchObject({ canViewHistory: false });
    expect(await as(VIEWER).query(api.slates.getById, { id: slateId })).toMatchObject({ canViewHistory: true });
  });

  it("renames, and deletes a version together with its chunks", async () => {
    const { slateId } = await setup();
    await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("a")] });
    await as(EDITOR).mutation(api.versions.create, { slateId, label: "draft" });
    const [meta] = await as(OWNER).query(api.versions.list, { slateId });
    await as(OWNER).mutation(api.versions.rename, { versionId: meta.id, label: "Final" });
    expect((await as(OWNER).query(api.versions.list, { slateId }))[0].label).toBe("Final");
    await as(OWNER).mutation(api.versions.remove, { versionId: meta.id });
    expect(await as(OWNER).query(api.versions.list, { slateId })).toEqual([]);
    expect(await count("versionChunks")).toBe(0);
    expect(await as(OWNER).query(api.versions.get, { versionId: meta.id })).toBeNull();
    await as(OWNER).mutation(api.versions.remove, { versionId: meta.id }); // idempotent
  });

  it("refuses boards too large to snapshot, and archived boards disappear", async () => {
    const { slateId } = await setup();
    const c = await getCollections();
    await c.elements.insertMany(Array.from({ length: 6001 }, (_, i) => ({ _id: newDocId(), slateId, eid: `x${i}`, seq: i + 1, z: i, rev: 1, data: "{}", updatedAt: 1 })));
    await expect(as(OWNER).mutation(api.versions.create, { slateId })).rejects.toThrow(/too large/);
    expect(await count("slateVersions")).toBe(0);
    await as(OWNER).mutation(api.slates.remove, { id: slateId });
    expect(await as(OWNER).query(api.versions.list, { slateId })).toEqual([]);
  });

  describe("automatic versions", () => {
    const edit = (slateId: string, id: string, x: number, deferred?: Deferred) => as(EDITOR, deferred).mutation(api.elements.apply, { slateId, ops: [put(id, 1, { x })] });
    const quietFor11Minutes = async (slateId: string) => (await getCollections()).slates.updateOne({ _id: slateId }, { $set: { lastAutoVersionAt: Date.now() - 11 * 60_000 } });

    it("are not taken on a brand-new board", async () => {
      const { slateId } = await setup();
      const deferred = new Deferred();
      await edit(slateId, "a", 1, deferred);
      expect(deferred.pending).toBe(0);
      await deferred.flush();
      expect(await count("slateVersions")).toBe(0);
      expect((await (await getCollections()).slates.findOne({ _id: slateId }))?.lastAutoVersionAt).toBeUndefined();
    });

    it("are scheduled by edits at most once per interval, and skip unchanged or empty boards", async () => {
      const { slateId } = await setup();
      const deferred = new Deferred();
      await quietFor11Minutes(slateId); // pretend the board has been quiet for 11 minutes

      await edit(slateId, "a", 1, deferred);
      await edit(slateId, "a", 2, deferred); // within the same interval: must not schedule a second one
      expect(deferred.pending).toBe(1);
      await deferred.flush();
      let versions = await as(OWNER).query(api.versions.list, { slateId });
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ kind: "auto", elementCount: 1 });
      expect(versions[0].label).toBeUndefined();
      expect((await (await getCollections()).slates.findOne({ _id: slateId }))?.lastAutoVersionAt).toBeGreaterThan(Date.now() - 5000);

      // unchanged board: a direct run records nothing new
      expect(await autoSnapshot(slateId)).toEqual({ ok: false, reason: "unchanged" });
      // later, the next edit takes the next one
      await quietFor11Minutes(slateId);
      await edit(slateId, "b", 5, deferred);
      await deferred.flush();
      versions = await as(OWNER).query(api.versions.list, { slateId });
      expect(versions).toHaveLength(2);
      expect(versions[0].elementCount).toBe(2);

      // empty board / archived board: nothing to record
      await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [{ t: "del", id: "a" }, { t: "del", id: "b" }] });
      expect(await autoSnapshot(slateId)).toEqual({ ok: false, reason: "empty" });
      await as(OWNER).mutation(api.slates.remove, { id: slateId });
      expect(await autoSnapshot(slateId)).toEqual({ ok: false, reason: "gone" });
    });

    it("never fail an edit when the board is too big to snapshot", async () => {
      const { slateId } = await setup();
      const c = await getCollections();
      await quietFor11Minutes(slateId);
      await c.elements.insertMany(Array.from({ length: 6001 }, (_, i) => ({ _id: newDocId(), slateId, eid: `x${i}`, seq: i + 1, z: i, rev: 1, data: "{}", updatedAt: 1 })));
      const deferred = new Deferred();
      await edit(slateId, "a", 1, deferred); // still succeeds
      await deferred.flush();
      expect(await count("slateVersions")).toBe(0);
    });

    it("keep only the newest ones, and never touch named versions", async () => {
      const { slateId } = await setup();
      await as(EDITOR).mutation(api.elements.apply, { slateId, ops: [put("keep")] });
      await as(OWNER).mutation(api.versions.create, { slateId, label: "Release 1.0" });
      for (let i = 0; i < MAX_AUTO_VERSIONS + 5; i++) {
        await edit(slateId, "moving", i);
        expect(await autoSnapshot(slateId)).toMatchObject({ ok: true });
      }
      const versions = await as(OWNER).query(api.versions.list, { slateId });
      expect(versions.filter((v) => v.kind === "auto")).toHaveLength(MAX_AUTO_VERSIONS);
      expect(versions.filter((v) => v.kind === "manual").map((v) => v.label)).toEqual(["Release 1.0"]);
      // the newest automatic version is the last state; pruned versions took their chunks with them
      const newest = versions.find((v) => v.kind === "auto")!;
      const els = parseSnapshot((await as(OWNER).query(api.versions.get, { versionId: newest.id }))!.chunks) as { id: string; x: number }[];
      expect(els.find((e) => e.id === "moving")!.x).toBe(MAX_AUTO_VERSIONS + 4);
      expect(await count("versionChunks")).toBe(versions.length);
    });

    it("naming an automatic version keeps it for good", async () => {
      const { slateId } = await setup();
      await edit(slateId, "a", 1);
      await autoSnapshot(slateId);
      const [auto] = await as(OWNER).query(api.versions.list, { slateId });
      expect(auto.kind).toBe("auto");
      await as(OWNER).mutation(api.versions.rename, { versionId: auto.id, label: "Demo day" });
      for (let i = 0; i < MAX_AUTO_VERSIONS + 2; i++) {
        await edit(slateId, "a", 100 + i);
        await autoSnapshot(slateId);
      }
      const versions = await as(OWNER).query(api.versions.list, { slateId });
      expect(versions.find((v) => v.id === auto.id)).toMatchObject({ kind: "manual", label: "Demo day" });
    });
  });

  it("limits named versions per board", async () => {
    const { slateId } = await setup();
    const c = await getCollections();
    await c.slateVersions.insertMany(Array.from({ length: MAX_MANUAL_VERSIONS }, (_, i) => ({ _id: newDocId(), slateId, kind: "manual" as const, label: `v${i}`, createdAt: i, elementCount: 0, bytes: 2, chunkCount: 1, hash: `h${i}` })));
    await expect(as(OWNER).mutation(api.versions.create, { slateId, label: "one more" })).rejects.toThrow(/50 named versions/);
    // the "Before restoring..." safety copy is an automatic version, so it is still allowed
    expect(await as(OWNER).mutation(api.versions.create, { slateId, kind: "auto", label: "Before restoring v3" })).toMatchObject({ ok: true });
  });
});
