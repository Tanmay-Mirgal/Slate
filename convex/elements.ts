import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { loadSlate, requireEdit, resolveAccess } from "./access";
import { SHARD_COUNT, shardOf } from "./shards";

const MAX_OPS = 500;
const MAX_ELEMENT_BYTES = 250_000;
const MAX_ID = 80;
/** Only touch `slates.lastEdited` this often, so busy boards don't contend on the slate document. */
const TOUCH_INTERVAL_MS = 30_000;

const opValidator = v.union(
  v.object({ t: v.literal("put"), id: v.string(), z: v.number(), data: v.string() }),
  v.object({ t: v.literal("del"), id: v.string() })
);

/** All elements of one shard of a slate. Clients subscribe to every shard 0..SHARD_COUNT-1. */
export const list = query({
  args: { slateId: v.id("slates"), shard: v.number() },
  handler: async (ctx, args) => {
    // Quietly empty (never throw) when access is missing or revoked mid-session, so subscribed
    // clients don't crash; the page handles the "no access" state from slates.getById.
    const slate = await loadSlate(ctx, args.slateId);
    if (!slate || !(await resolveAccess(ctx, slate))) return [];
    if (!Number.isInteger(args.shard) || args.shard < 0 || args.shard >= SHARD_COUNT) return [];
    const rows = await ctx.db
      .query("elements")
      .withIndex("by_slate_shard", (q) => q.eq("slateId", args.slateId).eq("shard", args.shard))
      .collect();
    return rows.map((r) => ({ eid: r.eid, z: r.z, rev: r.rev, data: r.data }));
  },
});

/** Applies a batch of puts / deletes atomically. One call per user gesture. */
export const apply = mutation({
  args: { slateId: v.id("slates"), ops: v.array(opValidator) },
  handler: async (ctx, args) => {
    const { slate, access } = await requireEdit(ctx, args.slateId);
    if (args.ops.length > MAX_OPS) throw new Error(`Too many operations in one batch (max ${MAX_OPS})`);
    const now = Date.now();

    // Later ops for the same element win; collapse so each row is written once.
    const latest = new Map<string, (typeof args.ops)[number]>();
    for (const op of args.ops) {
      if (op.id.length === 0 || op.id.length > MAX_ID) throw new Error("Invalid element id");
      if (op.t === "put") {
        if (op.data.length > MAX_ELEMENT_BYTES) throw new Error("Element is too large");
        if (!Number.isFinite(op.z)) throw new Error("Invalid z-order");
      }
      latest.set(op.id, op);
    }

    for (const op of latest.values()) {
      const existing = await ctx.db
        .query("elements")
        .withIndex("by_slate_eid", (q) => q.eq("slateId", args.slateId).eq("eid", op.id))
        .unique();
      if (op.t === "del") {
        if (existing) await ctx.db.delete(existing._id);
        continue;
      }
      if (existing) {
        if (existing.data !== op.data || existing.z !== op.z) {
          await ctx.db.patch(existing._id, { data: op.data, z: op.z, rev: existing.rev + 1, updatedAt: now, updatedBy: access.userId ?? undefined });
        }
      } else {
        await ctx.db.insert("elements", {
          slateId: args.slateId,
          eid: op.id,
          shard: shardOf(op.id),
          z: op.z,
          rev: 1,
          data: op.data,
          updatedAt: now,
          updatedBy: access.userId ?? undefined,
        });
      }
    }

    if (now - slate.lastEdited > TOUCH_INTERVAL_MS) await ctx.db.patch(slate._id, { lastEdited: now });
    return { applied: latest.size };
  },
});

/**
 * One-time migration of a schema-v1 slate (whole canvas stored as one JSON string on the slate).
 * The browser converts the legacy elements and sends them here; the legacy field is then removed.
 */
export const importLegacy = mutation({
  args: { slateId: v.id("slates"), ops: v.array(opValidator) },
  handler: async (ctx, args) => {
    const { slate, access } = await requireEdit(ctx, args.slateId);
    if (slate.elements === undefined || (slate.schemaVersion ?? 1) >= 2) return { imported: 0 };
    if (args.ops.length > 5000) throw new Error("Legacy board is too large to import in one step");
    const now = Date.now();
    let imported = 0;
    for (const op of args.ops) {
      if (op.t !== "put" || op.id.length === 0 || op.id.length > MAX_ID || op.data.length > MAX_ELEMENT_BYTES) continue;
      const exists = await ctx.db
        .query("elements")
        .withIndex("by_slate_eid", (q) => q.eq("slateId", args.slateId).eq("eid", op.id))
        .unique();
      if (exists) continue;
      await ctx.db.insert("elements", {
        slateId: args.slateId,
        eid: op.id,
        shard: shardOf(op.id),
        z: op.z,
        rev: 1,
        data: op.data,
        updatedAt: now,
        updatedBy: access.userId ?? undefined,
      });
      imported++;
    }
    await ctx.db.patch(slate._id, { elements: undefined, schemaVersion: 2 });
    return { imported };
  },
});
