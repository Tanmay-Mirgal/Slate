import { describe, expect, it } from "vitest";
import { BadRow, CONVEX_STORAGE_URL, mapRow } from "@/lib/db/convex-import";

const doc = (table: Parameters<typeof mapRow>[0], row: Record<string, unknown>, now?: number) => {
  const r = mapRow(table, row, now);
  if ("skip" in r) throw new Error(`skipped: ${r.skip}`);
  return r.doc;
};

describe("mapping a Convex export row to a MongoDB document", () => {
  it("keeps the Convex id as _id and drops _creationTime", () => {
    const d = doc("workspaces", { _id: "js70abc", _creationTime: 1783352760075.0303, name: "WS", ownerId: "user_1", createdAt: 5, updatedAt: 6 });
    expect(d).toEqual({ _id: "js70abc", name: "WS", ownerId: "user_1", createdAt: 5, updatedAt: 6 });
  });

  it("gives users the new profile fields without touching billing state", () => {
    const d = doc("users", { _id: "u1", _creationTime: 1783243890341.9702, clerkId: "user_1", email: "Ada@Example.com", firstName: "Ada", lastName: null, imageUrl: null, plan: "MAX", paymentId: "vip" });
    expect(d).toMatchObject({ _id: "u1", clerkId: "user_1", email: "Ada@Example.com", emails: ["ada@example.com"], plan: "MAX", paymentId: "vip", createdAt: 1783243890341, updatedAt: 1783243890341 });
    expect(d).not.toHaveProperty("_creationTime");
    expect(doc("users", { _id: "u2", clerkId: "user_2", email: "" }).emails).toEqual([]);
  });

  it("turns a board's creation time into createdAt and keeps its legacy canvas untouched", () => {
    const d = doc("slates", { _id: "s1", _creationTime: 1790316289842.125, title: "gh", isArchived: false, lastEdited: 9, thumbnailIcon: "5", elements: '[{"id":"old"}]', workspaceId: "w1" });
    expect(d).toMatchObject({ _id: "s1", createdAt: 1790316289842, elements: '[{"id":"old"}]', workspaceId: "w1", isArchived: false });
    expect(d).not.toHaveProperty("schemaVersion"); // still a schema-v1 board: the first editor converts it
  });

  it("drops the shard from elements (the change feed replaced sharding)", () => {
    const d = doc("elements", { _id: "e1", _creationTime: 1, slateId: "s1", eid: "a", shard: 3, z: 2, rev: 4, data: "{}", updatedAt: 7, updatedBy: "user_1" });
    expect(d).toEqual({ _id: "e1", slateId: "s1", eid: "a", z: 2, rev: 4, data: "{}", updatedAt: 7, updatedBy: "user_1" });
  });

  it("passes rows of the other tables through unchanged", () => {
    const row = { _id: "c1", _creationTime: 2, threadId: "t1", slateId: "s1", authorId: "u", authorName: "A", body: "hi", mentions: [], createdAt: 3 };
    expect(doc("comments", row)).toEqual({ _id: "c1", threadId: "t1", slateId: "s1", authorId: "u", authorName: "A", body: "hi", mentions: [], createdAt: 3 });
  });

  it("expires old webhook delivery ids instead of copying them", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    expect(mapRow("billingEvents", { _id: "b1", eventId: "e", type: "t", processedAt: now - 40 * day }, now)).toEqual({ skip: "delivery id older than the retention window" });
    const fresh = doc("billingEvents", { _id: "b2", eventId: "e2", type: "t", processedAt: now - 2 * day }, now);
    expect((fresh.expireAt as Date).getTime()).toBe(now - 2 * day + 30 * day);
  });

  it("rejects rows it cannot place", () => {
    expect(() => mapRow("users", { clerkId: "x" })).toThrow(BadRow);
    expect(() => mapRow("users", { _id: "u" })).toThrow(/no clerkId/);
    expect(() => mapRow("elements", { _id: "e", slateId: "s" })).toThrow(/missing slateId or eid/);
  });

  it("recognises links into Convex file storage, so a migration never leaves dead image links", () => {
    expect(CONVEX_STORAGE_URL.test("https://happy-animal-123.convex.cloud/api/storage/abc-123")).toBe(true);
    expect(CONVEX_STORAGE_URL.test('{"src":"https://x.convex.site/api/storage/q"}')).toBe(true);
    expect(CONVEX_STORAGE_URL.test("https://example.com/api/storage/abc")).toBe(false);
    expect(CONVEX_STORAGE_URL.test("/api/files/abc")).toBe(false);
  });
});
