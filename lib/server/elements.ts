import { z } from "zod";
import type { AnyBulkWriteOperation } from "mongodb";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { ElementDoc, Id } from "@/lib/db/types";
import { shouldAutoSnapshot } from "@/lib/canvas/version-snapshot";
import { loadSlate, requireEdit, resolveAccess } from "./access";
import { AppError, mutation, query, zId } from "./fn";
import { autoSnapshot } from "./versions";

const MAX_OPS = 500;
const MAX_ELEMENT_BYTES = 250_000;
const MAX_ID = 80;
/** Only touch `slates.lastEdited` this often, so busy boards don't contend on the slate document. */
const TOUCH_INTERVAL_MS = 30_000;
/**
 * A change feed ordered by a counter has a gap: writer A may take number 10, writer B number 11, and B
 * can become visible first. Readers therefore also re-read anything written in the last few seconds
 * (they ignore what they already have, matching on `rev`), so a late A is never missed.
 */
const OVERLAP_MS = 5_000;
/** Deleted-element markers are kept this long, so a client that was offline for less than this still learns about deletes. */
const TOMBSTONE_TTL_MS = 6 * 60 * 60_000;

const opSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("put"), id: z.string(), z: z.number(), data: z.string() }),
  z.object({ t: z.literal("del"), id: z.string() }),
]);
type Op = z.infer<typeof opSchema>;

/**
 * Everything that changed on a board since `since` (0 = send the whole board). Clients poll this.
 * `cursor` is the value to send next time. `full` means "this is the complete board, replace what you
 * have": the first load, or a client that was away longer than deleted-element markers are kept.
 */
export const sync = query({
  args: z.object({ slateId: zId, since: z.number().int().min(0).optional() }),
  handler: async (ctx, args) => {
    const since = args.since ?? 0;
    const none = { full: false, cursor: since, puts: [] as { eid: string; z: number; rev: number; data: string }[], dels: [] as string[] };
    // Quietly empty (never throw) when access is missing or revoked mid-session, so polling clients
    // don't crash; the page handles the "no access" state from slates.getById.
    const slate = await loadSlate(args.slateId);
    if (!slate || !(await resolveAccess(ctx, slate))) return none;

    const full = since === 0 || since < (slate.tombstoneFloor ?? 0);
    const c = await getCollections();
    const filter = full
      ? { slateId: args.slateId, deleted: { $ne: true } }
      : { slateId: args.slateId, $or: [{ seq: { $gt: since } }, { updatedAt: { $gte: Date.now() - OVERLAP_MS } }] };
    const rows = await c.elements.find(filter).project<Pick<ElementDoc, "eid" | "z" | "rev" | "data" | "deleted" | "seq">>({ eid: 1, z: 1, rev: 1, data: 1, deleted: 1, seq: 1 }).toArray();

    let cursor = full ? 0 : since;
    const puts: typeof none.puts = [];
    const dels: string[] = [];
    for (const r of rows) {
      if (r.seq > cursor) cursor = r.seq;
      if (r.deleted) dels.push(r.eid);
      else puts.push({ eid: r.eid, z: r.z, rev: r.rev, data: r.data });
    }
    return { full, cursor, puts, dels };
  },
});

/** Applies a batch of puts / deletes. One call per user gesture. */
export const apply = mutation({
  args: z.object({ slateId: zId, ops: z.array(opSchema) }),
  handler: async (ctx, args) => {
    const { slate, access } = await requireEdit(ctx, args.slateId);
    if (args.ops.length > MAX_OPS) throw new AppError(`Too many operations in one batch (max ${MAX_OPS})`);
    const now = Date.now();

    // Later ops for the same element win; collapse so each row is written once.
    const latest = new Map<string, Op>();
    for (const op of args.ops) {
      if (op.id.length === 0 || op.id.length > MAX_ID) throw new AppError("Invalid element id");
      if (op.t === "put") {
        if (op.data.length > MAX_ELEMENT_BYTES) throw new AppError("Element is too large");
        if (!Number.isFinite(op.z)) throw new AppError("Invalid z-order");
      }
      latest.set(op.id, op);
    }

    const c = await getCollections();
    const existing = new Map<string, Pick<ElementDoc, "eid" | "data" | "z" | "deleted">>();
    if (latest.size > 0) {
      const found = await c.elements
        .find({ slateId: args.slateId, eid: { $in: Array.from(latest.keys()) } })
        .project<Pick<ElementDoc, "eid" | "data" | "z" | "deleted">>({ eid: 1, data: 1, z: 1, deleted: 1 })
        .toArray();
      for (const e of found) existing.set(e.eid, e);
    }

    // only real changes get a sequence number: re-sending an identical element is a no-op
    const changes: Op[] = [];
    for (const op of latest.values()) {
      const cur = existing.get(op.id);
      if (op.t === "del") {
        if (cur && !cur.deleted) changes.push(op);
      } else if (!cur || cur.deleted || cur.data !== op.data || cur.z !== op.z) {
        changes.push(op);
      }
    }

    let hasDeletes = false;
    if (changes.length > 0) {
      // Reserve a block of sequence numbers atomically, then write all rows in one round trip.
      const bumped = await c.slates.findOneAndUpdate({ _id: args.slateId }, { $inc: { elementSeq: changes.length } }, { returnDocument: "after", projection: { elementSeq: 1 } });
      let seq = (bumped?.elementSeq ?? changes.length) - changes.length;
      const by = access.userId ?? undefined;
      const writes: AnyBulkWriteOperation<ElementDoc>[] = changes.map((op) => {
        seq += 1;
        if (op.t === "del") {
          hasDeletes = true;
          return { updateOne: { filter: { slateId: args.slateId, eid: op.id }, update: { $set: { deleted: true, data: "", seq, updatedAt: now, ...(by ? { updatedBy: by } : {}) }, $inc: { rev: 1 } } } };
        }
        return {
          updateOne: {
            filter: { slateId: args.slateId, eid: op.id },
            update: {
              $set: { z: op.z, data: op.data, seq, updatedAt: now, ...(by ? { updatedBy: by } : {}) },
              $unset: { deleted: "" },
              $inc: { rev: 1 },
              $setOnInsert: { _id: newDocId() },
            },
            upsert: true,
          },
        };
      });
      await c.elements.bulkWrite(writes, { ordered: false });
    }

    // Housekeeping on the slate document, in at most one write: the activity timestamp (every 30 s)
    // and the "time for an automatic version" marker (every ~10 min).
    const patch: { lastEdited?: number; lastAutoVersionAt?: number } = {};
    if (now - slate.lastEdited > TOUCH_INTERVAL_MS) patch.lastEdited = now;
    const wantsSnapshot = latest.size > 0 && shouldAutoSnapshot({ now, lastAutoAt: slate.lastAutoVersionAt, createdAt: slate.createdAt });
    if (wantsSnapshot) patch.lastAutoVersionAt = now;
    if (Object.keys(patch).length > 0) await c.slates.updateOne({ _id: slate._id }, { $set: patch });
    // its own task, after the response: a board too big to snapshot must never make editing fail
    if (wantsSnapshot) ctx.defer(() => autoSnapshot(args.slateId));
    if (hasDeletes && Math.random() < 0.1) ctx.defer(() => purgeTombstones(args.slateId));
    return { applied: latest.size };
  },
});

/**
 * Forgets deleted-element markers older than TOMBSTONE_TTL_MS. Clients that were away for longer than
 * that notice through `tombstoneFloor` and reload the whole board instead of asking for a delta.
 */
export async function purgeTombstones(slateId: Id<"slates">, olderThan = Date.now() - TOMBSTONE_TTL_MS): Promise<number> {
  const c = await getCollections();
  const old = await c.elements.find({ slateId, deleted: true, updatedAt: { $lt: olderThan } }).project<Pick<ElementDoc, "_id" | "seq">>({ seq: 1 }).limit(2000).toArray();
  if (old.length === 0) return 0;
  const floor = Math.max(...old.map((o) => o.seq));
  await c.slates.updateOne({ _id: slateId }, { $max: { tombstoneFloor: floor } });
  const res = await c.elements.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  return res.deletedCount;
}

/**
 * One-time migration of a schema-v1 slate (whole canvas stored as one JSON string on the slate).
 * The browser converts the legacy elements and sends them here; the legacy field is then removed.
 */
export const importLegacy = mutation({
  args: z.object({ slateId: zId, ops: z.array(opSchema) }),
  handler: async (ctx, args) => {
    const { slate, access } = await requireEdit(ctx, args.slateId);
    const c = await getCollections();
    const legacy = await c.slates.findOne({ _id: slate._id }, { projection: { elements: 1 } });
    if (legacy?.elements === undefined || (slate.schemaVersion ?? 1) >= 2) return { imported: 0 };
    if (args.ops.length > 5000) throw new AppError("Legacy board is too large to import in one step");

    const now = Date.now();
    const puts = args.ops.filter((op): op is Extract<Op, { t: "put" }> => op.t === "put" && op.id.length > 0 && op.id.length <= MAX_ID && op.data.length <= MAX_ELEMENT_BYTES);
    const have = new Set(
      (await c.elements.find({ slateId: args.slateId, eid: { $in: puts.map((p) => p.id) } }).project<{ eid: string }>({ eid: 1 }).toArray()).map((e) => e.eid)
    );
    const fresh = Array.from(new Map(puts.filter((p) => !have.has(p.id)).map((p) => [p.id, p])).values());
    if (fresh.length > 0) {
      const bumped = await c.slates.findOneAndUpdate({ _id: args.slateId }, { $inc: { elementSeq: fresh.length } }, { returnDocument: "after", projection: { elementSeq: 1 } });
      let seq = (bumped?.elementSeq ?? fresh.length) - fresh.length;
      await c.elements.insertMany(
        fresh.map((op) => ({ _id: newDocId(), slateId: args.slateId, eid: op.id, seq: ++seq, z: op.z, rev: 1, data: op.data, updatedAt: now, ...(access.userId ? { updatedBy: access.userId } : {}) })),
        { ordered: false }
      );
    }
    await c.slates.updateOne({ _id: slate._id }, { $unset: { elements: "" }, $set: { schemaVersion: 2 } });
    return { imported: fresh.length };
  },
});
