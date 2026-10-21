import { z } from "zod";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { Id, SlateDoc, SlateVersionDoc } from "@/lib/db/types";
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
} from "@/lib/canvas/version-snapshot";
import { canViewHistory, loadSlate, requireManage, resolveAccess } from "./access";
import { AppError, mutation, query, zId } from "./fn";
import { displayName } from "./profile";

/** Versions returned by `list`: the caps below plus some slack. */
const LIST_LIMIT = MAX_AUTO_VERSIONS + MAX_MANUAL_VERSIONS + 20;

export type SnapshotOutcome = { ok: true; versionId: Id<"slateVersions">; elementCount: number; bytes: number } | { ok: false; reason: "empty" | "unchanged" | "too-large" };

const metaOf = (v: SlateVersionDoc) => ({
  id: v._id,
  kind: v.kind,
  label: v.label,
  createdAt: v.createdAt,
  authorName: v.authorName,
  elementCount: v.elementCount,
  bytes: v.bytes,
});

async function latestVersion(slateId: Id<"slates">) {
  const c = await getCollections();
  return await c.slateVersions.findOne({ slateId }, { sort: { createdAt: -1 } });
}

/**
 * Serialises the board as it is right now into one version: ONE JSON array cut into a few chunk rows.
 * The element rows are only read, never copied. Refuses boards that would not fit comfortably in one
 * request (reported, not thrown, so the caller can decide how loud to be).
 */
async function captureSnapshot(
  slate: SlateDoc,
  meta: { kind: VersionKind; label?: string; authorId?: string; authorName?: string; skipIfUnchanged?: boolean; allowEmpty?: boolean }
): Promise<SnapshotOutcome> {
  const c = await getCollections();
  const rows = await c.elements
    .find({ slateId: slate._id, deleted: { $ne: true } })
    .project<{ eid: string; z: number; data: string }>({ eid: 1, z: 1, data: 1 })
    .limit(MAX_SNAPSHOT_ELEMENTS + 1)
    .toArray();
  if (rows.length > MAX_SNAPSHOT_ELEMENTS) return { ok: false, reason: "too-large" };

  const built = buildSnapshot(rows);
  if (built.count === 0 && !meta.allowEmpty) return { ok: false, reason: "empty" };
  const bytes = utf8Length(built.json);
  if (bytes > MAX_SNAPSHOT_BYTES) return { ok: false, reason: "too-large" };

  const hash = contentHash(built.json);
  if (meta.skipIfUnchanged) {
    const last = await latestVersion(slate._id);
    if (last && last.hash === hash) return { ok: false, reason: "unchanged" };
  }

  const chunks = chunkString(built.json);
  const versionId = newDocId();
  // chunks first: a version row only ever points at chunks that exist
  await c.versionChunks.insertMany(chunks.map((data, seq) => ({ _id: newDocId(), versionId, slateId: slate._id, seq, data })));
  await c.slateVersions.insertOne({
    _id: versionId,
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

  // keep only the newest automatic versions; named ones are never pruned
  const all = await c.slateVersions.find({ slateId: slate._id }).sort({ createdAt: -1 }).limit(LIST_LIMIT + 50).project<Pick<SlateVersionDoc, "_id" | "kind" | "createdAt">>({ kind: 1, createdAt: 1 }).toArray();
  const doomed = pruneAuto(all.map((x) => ({ id: x._id, kind: x.kind, createdAt: x.createdAt })));
  for (const id of doomed) await deleteVersionRows(id);

  return { ok: true, versionId, elementCount: built.count, bytes };
}

async function deleteVersionRows(versionId: Id<"slateVersions">) {
  const c = await getCollections();
  await c.versionChunks.deleteMany({ versionId });
  await c.slateVersions.deleteOne({ _id: versionId });
}

async function manualCount(slateId: Id<"slates">): Promise<number> {
  const c = await getCollections();
  return await c.slateVersions.countDocuments({ slateId, kind: "manual" });
}

/* ---------------------------------------------------------------------- reads */

/** Versions of a board, newest first. Members only; empty (never an error) for everybody else. */
export const list = query({
  args: z.object({ slateId: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.slateId);
    if (!slate) return [];
    const access = await resolveAccess(ctx, slate);
    if (!access || !canViewHistory(access)) return [];
    const c = await getCollections();
    const rows = await c.slateVersions.find({ slateId: args.slateId }).sort({ createdAt: -1 }).limit(LIST_LIMIT).toArray();
    return rows.map(metaOf);
  },
});

/** One version with its payload chunks (the browser joins, parses and validates them). */
export const get = query({
  args: z.object({ versionId: zId }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const version = await c.slateVersions.findOne({ _id: args.versionId });
    if (!version) return null;
    const slate = await loadSlate(version.slateId);
    if (!slate) return null;
    const access = await resolveAccess(ctx, slate);
    if (!access || !canViewHistory(access)) return null;
    const chunks = await c.versionChunks.find({ versionId: args.versionId }).sort({ seq: 1 }).toArray();
    return { ...metaOf(version), chunks: chunks.map((x) => x.data) };
  },
});

/* --------------------------------------------------------------------- writes */

/**
 * Saves the board as it is now. Workspace members with edit rights only. `kind: "auto"` is used by
 * the browser for the "Before restoring..." safety copy, which is pruned like any automatic version.
 */
export const create = mutation({
  args: z.object({ slateId: zId, label: z.string().optional(), kind: z.enum(["manual", "auto"]).optional() }),
  handler: async (ctx, args): Promise<SnapshotOutcome> => {
    const { slate, access } = await requireManage(ctx, args.slateId);
    const kind = args.kind ?? "manual";
    if (kind === "manual" && (await manualCount(args.slateId)) >= MAX_MANUAL_VERSIONS) {
      throw new AppError(`You can keep ${MAX_MANUAL_VERSIONS} named versions per board. Delete an old one first.`);
    }
    const me = access.userId ? await ctx.profile() : null;
    const out = await captureSnapshot(slate, {
      kind,
      label: cleanLabel(args.label),
      authorId: access.userId ?? undefined,
      authorName: access.userId ? displayName(me) : undefined,
      allowEmpty: true,
    });
    if (!out.ok && out.reason === "too-large") throw new AppError("This board is too large to save a version of.");
    return out;
  },
});

/** Names a version. Naming an automatic version keeps it for good (it becomes a named version). */
export const rename = mutation({
  args: z.object({ versionId: zId, label: z.string() }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const version = await c.slateVersions.findOne({ _id: args.versionId });
    if (!version) throw new AppError("This version no longer exists");
    await requireManage(ctx, version.slateId);
    const label = cleanLabel(args.label);
    if (version.kind === "auto" && label) {
      if ((await manualCount(version.slateId)) >= MAX_MANUAL_VERSIONS) {
        throw new AppError(`You can keep ${MAX_MANUAL_VERSIONS} named versions per board. Delete an old one first.`);
      }
      await c.slateVersions.updateOne({ _id: args.versionId }, { $set: { label, kind: "manual" } });
    } else if (label) {
      await c.slateVersions.updateOne({ _id: args.versionId }, { $set: { label } });
    } else {
      await c.slateVersions.updateOne({ _id: args.versionId }, { $unset: { label: "" } });
    }
  },
});

export const remove = mutation({
  args: z.object({ versionId: zId }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const version = await c.slateVersions.findOne({ _id: args.versionId });
    if (!version) return;
    await requireManage(ctx, version.slateId);
    await deleteVersionRows(args.versionId);
  },
});

/**
 * Run (after the response) by `elements.apply` at most every AUTO_INTERVAL_MS while a board is being
 * edited. Separate from the edit itself so a board too big to snapshot can never make editing fail.
 * Not an RPC endpoint.
 */
export async function autoSnapshot(slateId: Id<"slates">): Promise<SnapshotOutcome | { ok: false; reason: "gone" }> {
  try {
    const slate = await loadSlate(slateId);
    if (!slate) return { ok: false, reason: "gone" };
    return await captureSnapshot(slate, { kind: "auto", skipIfUnchanged: true });
  } catch (e) {
    console.error("[versions] automatic snapshot failed:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "too-large" };
  }
}
