import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canViewHistory, loadSlate, requireManage, resolveAccess } from "./access";
import { profileOf } from "./profile";
import { SHARD_COUNT } from "./shards";
import {
  buildSnapshot,
  chunkString,
  cleanLabel,
  contentHash,
  MAX_AUTO_VERSIONS,
  MAX_MANUAL_VERSIONS,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ELEMENTS,
  pruneAuto,
  utf8Length,
  type VersionKind,
} from "./snapshot";

/** Versions returned by `list`: the caps below plus some slack. */
const LIST_LIMIT = MAX_AUTO_VERSIONS + MAX_MANUAL_VERSIONS + 20;

export type SnapshotOutcome = { ok: true; versionId: Id<"slateVersions">; elementCount: number; bytes: number } | { ok: false; reason: "empty" | "unchanged" | "too-large" };

const metaOf = (v: Doc<"slateVersions">) => ({
  id: v._id,
  kind: v.kind,
  label: v.label,
  createdAt: v.createdAt,
  authorName: v.authorName,
  elementCount: v.elementCount,
  bytes: v.bytes,
});

async function latestVersion(ctx: QueryCtx, slateId: Id<"slates">) {
  return await ctx.db
    .query("slateVersions")
    .withIndex("by_slate", (q) => q.eq("slateId", slateId))
    .order("desc")
    .first();
}

/**
 * Serialises the board as it is right now into one version: ONE JSON array cut into a few chunk rows.
 * The element rows are only read, never copied. Refuses boards that would not fit in a single
 * mutation (reported, not thrown, so the caller can decide how loud to be).
 */
async function captureSnapshot(
  ctx: MutationCtx,
  slate: Doc<"slates">,
  meta: { kind: VersionKind; label?: string; authorId?: string; authorName?: string; skipIfUnchanged?: boolean; allowEmpty?: boolean }
): Promise<SnapshotOutcome> {
  const rows: { eid: string; z: number; data: string }[] = [];
  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    const part = await ctx.db
      .query("elements")
      .withIndex("by_slate_shard", (q) => q.eq("slateId", slate._id).eq("shard", shard))
      .take(MAX_SNAPSHOT_ELEMENTS + 1);
    for (const r of part) rows.push({ eid: r.eid, z: r.z, data: r.data });
    if (rows.length > MAX_SNAPSHOT_ELEMENTS) return { ok: false, reason: "too-large" };
  }
  const built = buildSnapshot(rows);
  if (built.count === 0 && !meta.allowEmpty) return { ok: false, reason: "empty" };
  const bytes = utf8Length(built.json);
  if (bytes > MAX_SNAPSHOT_BYTES) return { ok: false, reason: "too-large" };

  const hash = contentHash(built.json);
  if (meta.skipIfUnchanged) {
    const last = await latestVersion(ctx, slate._id);
    if (last && last.hash === hash) return { ok: false, reason: "unchanged" };
  }

  const chunks = chunkString(built.json);
  const versionId = await ctx.db.insert("slateVersions", {
    slateId: slate._id,
    kind: meta.kind,
    label: meta.label,
    createdAt: Date.now(),
    authorId: meta.authorId,
    authorName: meta.authorName,
    elementCount: built.count,
    bytes,
    chunkCount: chunks.length,
    hash,
  });
  for (let seq = 0; seq < chunks.length; seq++) {
    await ctx.db.insert("versionChunks", { versionId, slateId: slate._id, seq, data: chunks[seq] });
  }

  // keep only the newest automatic versions; named ones are never pruned
  const all = await ctx.db
    .query("slateVersions")
    .withIndex("by_slate", (q) => q.eq("slateId", slate._id))
    .order("desc")
    .take(LIST_LIMIT + 50);
  const doomed = pruneAuto(all.map((x) => ({ id: x._id, kind: x.kind, createdAt: x.createdAt })));
  for (const id of doomed) await deleteVersionRows(ctx, id as Id<"slateVersions">);

  return { ok: true, versionId, elementCount: built.count, bytes };
}

async function deleteVersionRows(ctx: MutationCtx, versionId: Id<"slateVersions">) {
  const chunks = await ctx.db
    .query("versionChunks")
    .withIndex("by_version", (q) => q.eq("versionId", versionId))
    .collect();
  for (const c of chunks) await ctx.db.delete(c._id);
  await ctx.db.delete(versionId);
}

async function manualCount(ctx: QueryCtx, slateId: Id<"slates">): Promise<number> {
  const all = await ctx.db
    .query("slateVersions")
    .withIndex("by_slate", (q) => q.eq("slateId", slateId))
    .take(LIST_LIMIT + 50);
  return all.filter((x) => x.kind === "manual").length;
}

/* ---------------------------------------------------------------------- reads */

/** Versions of a board, newest first. Members only; empty (never an error) for everybody else. */
export const list = query({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await loadSlate(ctx, args.slateId);
    if (!slate) return [];
    const access = await resolveAccess(ctx, slate);
    if (!access || !canViewHistory(access)) return [];
    const rows = await ctx.db
      .query("slateVersions")
      .withIndex("by_slate", (q) => q.eq("slateId", args.slateId))
      .order("desc")
      .take(LIST_LIMIT);
    return rows.map(metaOf);
  },
});

/** One version with its payload chunks (the browser joins, parses and validates them). */
export const get = query({
  args: { versionId: v.id("slateVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return null;
    const slate = await loadSlate(ctx, version.slateId);
    if (!slate) return null;
    const access = await resolveAccess(ctx, slate);
    if (!access || !canViewHistory(access)) return null;
    const chunks = await ctx.db
      .query("versionChunks")
      .withIndex("by_version", (q) => q.eq("versionId", args.versionId))
      .collect();
    return { ...metaOf(version), chunks: chunks.sort((a, b) => a.seq - b.seq).map((c) => c.data) };
  },
});

/* --------------------------------------------------------------------- writes */

/**
 * Saves the board as it is now. Workspace members with edit rights only. `kind: "auto"` is used by
 * the browser for the "Before restoring..." safety copy, which is pruned like any automatic version.
 */
export const create = mutation({
  args: { slateId: v.id("slates"), label: v.optional(v.string()), kind: v.optional(v.union(v.literal("manual"), v.literal("auto"))) },
  handler: async (ctx, args): Promise<SnapshotOutcome> => {
    const { slate, access } = await requireManage(ctx, args.slateId);
    const kind = args.kind ?? "manual";
    if (kind === "manual" && (await manualCount(ctx, args.slateId)) >= MAX_MANUAL_VERSIONS) {
      throw new Error(`You can keep ${MAX_MANUAL_VERSIONS} named versions per board. Delete an old one first.`);
    }
    const identity = await ctx.auth.getUserIdentity();
    const me = access.userId ? await profileOf(ctx, access.userId, identity?.name) : null;
    const out = await captureSnapshot(ctx, slate, { kind, label: cleanLabel(args.label), authorId: me?.userId, authorName: me?.name, allowEmpty: true });
    if (!out.ok && out.reason === "too-large") throw new Error("This board is too large to save a version of.");
    return out;
  },
});

/** Names a version. Naming an automatic version keeps it for good (it becomes a named version). */
export const rename = mutation({
  args: { versionId: v.id("slateVersions"), label: v.string() },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new Error("This version no longer exists");
    await requireManage(ctx, version.slateId);
    const label = cleanLabel(args.label);
    if (version.kind === "auto" && label) {
      if ((await manualCount(ctx, version.slateId)) >= MAX_MANUAL_VERSIONS) {
        throw new Error(`You can keep ${MAX_MANUAL_VERSIONS} named versions per board. Delete an old one first.`);
      }
      await ctx.db.patch(args.versionId, { label, kind: "manual" });
    } else {
      await ctx.db.patch(args.versionId, { label });
    }
  },
});

export const remove = mutation({
  args: { versionId: v.id("slateVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return;
    await requireManage(ctx, version.slateId);
    await deleteVersionRows(ctx, args.versionId);
  },
});

/**
 * Scheduled by `elements.apply` at most every AUTO_INTERVAL_MS while a board is being edited. Runs
 * in its own transaction so a board too big to snapshot can never make editing fail.
 */
export const autoSnapshot = internalMutation({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args): Promise<SnapshotOutcome | { ok: false; reason: "gone" }> => {
    const slate = await loadSlate(ctx, args.slateId);
    if (!slate) return { ok: false, reason: "gone" };
    return await captureSnapshot(ctx, slate, { kind: "auto", skipIfUnchanged: true });
  },
});
