import { z } from "zod";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { BoardStatus, ExternalRef, Id, LinkAccess, SlateDoc } from "@/lib/db/types";
import { canComment, canModerate, canViewHistory, loadSlate, membershipOf, requireEdit, requireManage, requireView, resolveAccess } from "./access";
import { assertBoardCapacity, boardLimitFailure, countOwnedBoards, tierOf } from "./billing";
import { AppError, mutation, query, zId, zLinkAccess, type Ctx } from "./fn";
import { limitsFor } from "@/lib/billing/limits";
import { ensureDefaultWorkspace } from "./users";
import { connectorConfig, connectorEnabled } from "@/lib/connector/config";
import { loadBoardElements, namesFor } from "@/lib/connector/data";
import { actorOf, emitBoardEvent, retractCreated } from "@/lib/connector/events/board-events";
import { inOutbox } from "@/lib/connector/events/outbox";
import { graphFromElements } from "@/lib/diagram/extract";
import { graphToDsl } from "@/lib/diagram/dsl";

export const MAX_DOC_CHARS = 900_000;
const MAX_TITLE = 120;

/** Lightweight shape for lists: never ship canvas / document bodies to the dashboard. */
function summary(s: SlateDoc) {
  return {
    _id: s._id,
    _creationTime: s.createdAt,
    title: s.title,
    workspaceId: s.workspaceId,
    isArchived: s.isArchived,
    lastEdited: s.lastEdited,
    thumbnailIcon: s.thumbnailIcon,
    linkAccess: s.linkAccess ?? "none",
    // only boards the connected Hub has touched carry these, so every other board's summary is exactly as before
    ...(s.status ? { status: s.status } : {}),
    ...(s.createdVia === "connector" ? { createdVia: s.createdVia } : {}),
  };
}

interface DashboardExtras {
  isFavorite: boolean;
  /** `null` until an editor has opened the board since counts were introduced. */
  nodeCount: number | null;
  connectorCount: number | null;
}

/** Adds the per-user star and the reported node / connector counts that dashboard cards display. */
async function withExtras<T extends { _id: Id<"slates"> }>(userId: string, rows: T[]): Promise<(T & DashboardExtras)[]> {
  if (rows.length === 0) return [];
  const c = await getCollections();
  const ids = rows.map((r) => r._id);
  const [favorites, stats] = await Promise.all([
    c.slateFavorites.find({ userId, slateId: { $in: ids } }).toArray(),
    c.slateStats.find({ slateId: { $in: ids } }).toArray(),
  ]);
  const starred = new Set(favorites.map((f) => f.slateId));
  const statsOf = new Map(stats.map((s) => [s.slateId, s]));
  return rows.map((row) => {
    const s = statsOf.get(row._id);
    return { ...row, isFavorite: starred.has(row._id), nodeCount: s?.nodes ?? null, connectorCount: s?.connectors ?? null };
  });
}

const requireUser = (ctx: Ctx): string => {
  if (!ctx.userId) throw new AppError("Unauthenticated");
  return ctx.userId;
};

// Active slates of a workspace, newest first.
export const list = query({
  args: z.object({ workspaceId: zId }),
  handler: async (ctx, args) => {
    if (!ctx.userId) return [];
    if (!(await membershipOf(args.workspaceId, ctx.userId))) return [];
    const c = await getCollections();
    const slates = await c.slates
      .find({ workspaceId: args.workspaceId, isArchived: false }, { projection: { documentText: 0, documentJson: 0, elements: 0 } })
      .sort({ lastEdited: -1 })
      .limit(500)
      .toArray();
    return await withExtras(ctx.userId, slates.map(summary));
  },
});

export interface CreateBoardInput {
  title: string;
  /** Omit to use the caller's own workspace (created on the spot for a brand-new account). */
  workspaceId?: string;
  thumbnailIcon: string;
  /** Set by the ecosystem connector; boards made in the app carry nothing extra. */
  createdVia?: "ui" | "connector";
  metadata?: Record<string, unknown>;
  externalRef?: ExternalRef;
}

/**
 * Creates a board for the caller: role check, the workspace owner's plan limit, and the settle step that keeps a
 * burst of simultaneous creations from overshooting it. The `create` mutation below and the ecosystem connector
 * both go through here, so a board made either way obeys the same rules (and sends the same `board.created`).
 */
export async function createBoard(ctx: Ctx, args: CreateBoardInput): Promise<SlateDoc> {
  const userId = requireUser(ctx);
  const c = await getCollections();

  let workspaceId = args.workspaceId;
  if (!workspaceId) workspaceId = (await ensureDefaultWorkspace(userId, await ctx.profile()))._id;
  const membership = await membershipOf(workspaceId, userId);
  if (!membership || membership.role === "Viewer") throw new AppError("Unauthorized to create slates in this workspace");

  // The workspace owner's plan decides how many boards fit (throws { code: "board_limit" }).
  const workspace = await c.workspaces.findOne({ _id: workspaceId });
  if (!workspace) throw new AppError("Workspace not found");
  await assertBoardCapacity(workspace.ownerId);

  const now = Date.now();
  const doc: SlateDoc = {
    _id: newDocId(),
    title: args.title.trim().slice(0, MAX_TITLE) || "Untitled",
    workspaceId,
    isArchived: false,
    createdAt: now,
    lastEdited: now,
    thumbnailIcon: args.thumbnailIcon,
    linkAccess: "none",
    schemaVersion: 2,
    elementSeq: 0,
    ...(args.createdVia === "connector" ? { createdVia: "connector" as const } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.externalRef ? { externalRef: args.externalRef } : {}),
  };
  if (connectorEnabled()) {
    // the board and its `board.created` event commit together or not at all
    const actor = await actorOf(ctx, args.createdVia ?? "ui");
    await inOutbox(async (session) => {
      await c.slates.insertOne(doc, { session });
      await emitBoardEvent("board.created", doc, actor, undefined, session);
    });
  } else {
    await c.slates.insertOne(doc);
  }

  // Boards created at the same moment could all have passed the check above: settle it afterwards.
  // If that over-filled the plan, this board is taken back (so at worst a burst creates fewer than allowed, never more).
  const tier = await tierOf(workspace.ownerId);
  const limit = limitsFor(tier).maxBoards;
  if (limit !== null && (await countOwnedBoards(workspace.ownerId, limit + 1)) > limit) {
    await c.slates.deleteOne({ _id: doc._id });
    if (connectorEnabled()) await retractCreated(doc._id);
    throw boardLimitFailure(tier, limit);
  }
  return doc;
}

export const create = mutation({
  args: z.object({
    title: z.string().max(400),
    /** Omit to use the caller's own workspace (created on the spot for a brand-new account). */
    workspaceId: zId.optional(),
    thumbnailIcon: z.string().max(40),
  }),
  handler: async (ctx, args) => (await createBoard(ctx, args))._id,
});

export const rename = mutation({
  args: z.object({ id: zId, title: z.string().max(400) }),
  handler: async (ctx, args) => {
    const { slate } = await requireManage(ctx, args.id);
    const c = await getCollections();
    await c.slates.updateOne({ _id: slate._id }, { $set: { title: args.title.trim().slice(0, MAX_TITLE) || "Untitled", lastEdited: Date.now() } });
    return args.id;
  },
});

/** Soft delete (archive). Shared by the `remove` mutation and the ecosystem connector. */
export async function archiveBoard(ctx: Ctx, id: Id<"slates">, via: "ui" | "connector"): Promise<void> {
  const { slate } = await requireManage(ctx, id);
  const c = await getCollections();
  const patch = { $set: { isArchived: true, lastEdited: Date.now() } };
  if (!connectorEnabled()) {
    await c.slates.updateOne({ _id: slate._id }, patch);
    return;
  }
  const actor = await actorOf(ctx, via);
  await inOutbox(async (session) => {
    await c.slates.updateOne({ _id: slate._id }, patch, { session });
    await emitBoardEvent("board.archived", { ...slate, isArchived: true }, actor, undefined, session);
  });
}

export const remove = mutation({
  args: z.object({ id: zId }),
  handler: async (ctx, args) => {
    await archiveBoard(ctx, args.id, "ui");
    return args.id;
  },
});

/**
 * A slate plus what the caller may do with it. Works for signed-out visitors when link sharing is
 * on. Returns null (never throws) when the slate is missing or the caller has no access. The document
 * body is fetched separately (`getDocument`) so this stays small enough to poll.
 */
export const getById = query({
  args: z.object({ id: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.id);
    if (!slate) return null;
    const access = await resolveAccess(ctx, slate);
    if (!access) return null;
    const c = await getCollections();
    // only boards that predate per-element storage can still carry the legacy canvas string
    const mayBeLegacy = (slate.schemaVersion ?? 1) < 2;
    const [stats, legacy] = await Promise.all([
      c.slateStats.findOne({ slateId: slate._id }),
      mayBeLegacy ? c.slates.findOne({ _id: slate._id, elements: { $exists: true, $ne: "" } }, { projection: { _id: 1 } }) : null,
    ]);
    return {
      _id: slate._id,
      title: slate.title,
      workspaceId: slate.workspaceId,
      lastEdited: slate.lastEdited,
      linkAccess: slate.linkAccess ?? "none",
      /** True only for un-migrated schema-v1 boards; the client then fetches them with `getDocument`. */
      hasLegacyElements: !!legacy,
      access: access.level,
      canManage: access.via !== "link" && access.level === "edit",
      /** See the collaboration rules in access.ts. */
      canComment: canComment(access),
      canModerate: canModerate(access),
      canViewHistory: canViewHistory(access),
      stats: stats ? { nodes: stats.nodes, connectors: stats.connectors } : null,
      // review status and "created via the Hub": only present while the ecosystem connector is switched on
      ...(connectorEnabled() ? { connector: await connectorView(slate) } : {}),
    };
  },
});

async function connectorView(slate: SlateDoc) {
  let hubName: string | null = null;
  try {
    hubName = connectorConfig().hubName;
  } catch {
    /* misconfigured: the boot check says so; the board page just shows no Hub name */
  }
  const names = slate.statusChangedBy ? await namesFor([slate.statusChangedBy]) : new Map<string, string>();
  return {
    hubName,
    status: (slate.status ?? "draft") as BoardStatus,
    statusChangedAt: slate.statusChangedAt ?? null,
    statusChangedByName: slate.statusChangedBy ? names.get(slate.statusChangedBy) ?? null : null,
    createdVia: slate.createdVia ?? ("ui" as const),
  };
}

/** The rich-text document (and, for old boards, the legacy canvas) of a slate. Fetched once per visit. */
export const getDocument = query({
  args: z.object({ id: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.id);
    if (!slate || !(await resolveAccess(ctx, slate))) return null;
    const c = await getCollections();
    const full = await c.slates.findOne({ _id: args.id }, { projection: { documentText: 1, documentJson: 1, elements: 1, schemaVersion: 1 } });
    return {
      documentText: full?.documentText,
      documentJson: full?.documentJson,
      /** Present only for un-migrated schema-v1 boards; the client imports then clears it. */
      legacyElements: full?.elements && (full.schemaVersion ?? 1) < 2 ? full.elements : undefined,
    };
  },
});

/** Star / unstar a board for the caller. Anyone who can open the board can star it. */
export const setFavorite = mutation({
  args: z.object({ id: zId, favorite: z.boolean() }),
  handler: async (ctx, args) => {
    const { access } = await requireView(ctx, args.id);
    if (!access.userId) throw new AppError("Sign in to star boards");
    const userId = access.userId;
    const c = await getCollections();
    if (args.favorite) {
      await c.slateFavorites.updateOne({ userId, slateId: args.id }, { $setOnInsert: { _id: newDocId(), createdAt: Date.now() } }, { upsert: true });
    } else {
      await c.slateFavorites.deleteMany({ userId, slateId: args.id });
    }
    return args.favorite;
  },
});

/**
 * An editing client reports how many nodes and connectors the board has so dashboard cards can show
 * them without loading every element. Cheap and idempotent: unchanged counts write nothing.
 */
export const reportStats = mutation({
  args: z.object({ id: zId, nodes: z.number(), connectors: z.number() }),
  handler: async (ctx, args) => {
    await requireEdit(ctx, args.id);
    const clamp = (n: number) => Math.max(0, Math.min(1_000_000, Math.floor(Number.isFinite(n) ? n : 0)));
    const nodes = clamp(args.nodes);
    const connectors = clamp(args.connectors);
    const c = await getCollections();
    const row = await c.slateStats.findOne({ slateId: args.id });
    if (!row) {
      await c.slateStats
        .updateOne({ slateId: args.id }, { $set: { nodes, connectors, updatedAt: Date.now() }, $setOnInsert: { _id: newDocId() } }, { upsert: true })
        .catch((e) => {
          if ((e as { code?: number }).code !== 11000) throw e; // a concurrent first report won: fine
        });
    } else if (row.nodes !== nodes || row.connectors !== connectors) {
      await c.slateStats.updateOne({ _id: row._id }, { $set: { nodes, connectors, updatedAt: Date.now() } });
    }
    return { nodes, connectors };
  },
});

/** "Anyone with the link" setting. Shared by the `setLinkAccess` mutation and the ecosystem connector. */
export async function applyLinkAccess(ctx: Ctx, id: Id<"slates">, linkAccess: LinkAccess, via: "ui" | "connector"): Promise<LinkAccess> {
  const { slate } = await requireManage(ctx, id);
  const c = await getCollections();
  const patch = { $set: { linkAccess } };
  if (!connectorEnabled() || (slate.linkAccess ?? "none") === linkAccess) {
    await c.slates.updateOne({ _id: slate._id }, patch);
    return linkAccess;
  }
  const actor = await actorOf(ctx, via);
  await inOutbox(async (session) => {
    await c.slates.updateOne({ _id: slate._id }, patch, { session });
    await emitBoardEvent("board.shared", { ...slate, linkAccess }, actor, () => ({ linkAccess }), session);
  });
  return linkAccess;
}

export const setLinkAccess = mutation({
  args: z.object({ id: zId, linkAccess: zLinkAccess }),
  handler: async (ctx, args) => await applyLinkAccess(ctx, args.id, args.linkAccess, "ui"),
});

const zBoardStatus = z.enum(["draft", "in_review", "approved"]);

/**
 * Moves a board between draft, in review and approved (members who can edit). The change and the events it
 * causes (`board.status_changed`, and `board.approved` when approving) commit together. Shared by the `setStatus`
 * mutation behind the status pill and by the ecosystem connector's `boards.setStatus`.
 */
export async function applyBoardStatus(ctx: Ctx, id: Id<"slates">, to: BoardStatus, opts: { note?: string; via: "ui" | "connector" }): Promise<{ slate: SlateDoc; from: BoardStatus; to: BoardStatus; changed: boolean }> {
  if (!connectorEnabled()) throw new AppError("Board status is not available");
  const { slate, access } = await requireManage(ctx, id);
  const userId = access.userId;
  if (!userId) throw new AppError("Unauthenticated");
  const from: BoardStatus = slate.status ?? "draft";
  if (from === to) return { slate, from, to, changed: false };

  const now = Date.now();
  const actor = await actorOf(ctx, opts.via);
  const by = { id: userId, name: actor.name };
  const note = opts.note?.trim() || undefined;
  const after: SlateDoc = { ...slate, status: to, statusChangedAt: now, statusChangedBy: userId, lastEdited: now };

  // the approved diagram's size is read before the transaction so that it stays short
  let dslBytes = 0;
  if (to === "approved") {
    const graph = graphFromElements(await loadBoardElements(slate._id));
    dslBytes = graph.nodes.length ? Buffer.byteLength(graphToDsl(graph)) : 0;
  }

  const c = await getCollections();
  await inOutbox(async (session) => {
    // compare-and-set on the status we read: two people changing it at once cannot both claim the same "from"
    const moved = await c.slates.updateOne(
      { _id: slate._id, status: (from === "draft" ? { $in: [null, "draft"] } : from) as BoardStatus },
      { $set: { status: to, statusChangedAt: now, statusChangedBy: userId, lastEdited: now } },
      { session }
    );
    if (moved.matchedCount === 0) throw new AppError("The status was changed by someone else just now. Try again.");
    await emitBoardEvent("board.status_changed", after, actor, () => ({ from, to, ...(note ? { note } : {}), by }), session);
    if (to === "approved") {
      await emitBoardEvent("board.approved", after, actor, (board) => ({ ...(note ? { note } : {}), by, stats: board.stats ?? { nodes: 0, connectors: 0 }, dslBytes }), session);
    }
  });
  return { slate: after, from, to, changed: true };
}

export const setStatus = mutation({
  args: z.object({ id: zId, status: zBoardStatus, note: z.string().trim().max(500).optional() }),
  handler: async (ctx, args) => (await applyBoardStatus(ctx, args.id, args.status, { note: args.note, via: "ui" })).to,
});

// Rich-text document that lives next to the canvas
export const updateDocument = mutation({
  args: z.object({ id: zId, documentText: z.string(), documentJson: z.string().optional() }),
  handler: async (ctx, args) => {
    const { slate } = await requireEdit(ctx, args.id);
    if (args.documentText.length > MAX_DOC_CHARS || (args.documentJson?.length ?? 0) > MAX_DOC_CHARS) {
      throw new AppError("Document is too large");
    }
    const c = await getCollections();
    await c.slates.updateOne(
      { _id: slate._id },
      args.documentJson === undefined
        ? { $set: { documentText: args.documentText, lastEdited: Date.now() }, $unset: { documentJson: "" } }
        : { $set: { documentText: args.documentText, documentJson: args.documentJson, lastEdited: Date.now() } }
    );
    return args.id;
  },
});

// Slates shared WITH the user (workspaces where they are a member but not the owner)
export const listShared = query({
  handler: async (ctx) => {
    if (!ctx.userId) return [];
    const clerkId = ctx.userId;
    const c = await getCollections();
    const me = await ctx.profile();
    const myEmails = Array.from(new Set([me?.email, ...(me?.emails ?? [])].map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e)));

    const memberships = await c.workspaceMembers.find({ userId: clerkId }).limit(100).toArray();
    const workspaces = await c.workspaces.find({ _id: { $in: memberships.map((m) => m.workspaceId) } }).toArray();
    const foreign = workspaces.filter((w) => w.ownerId !== clerkId);
    if (foreign.length === 0) return [];

    // who shared each workspace: the person who invited me, else the owner
    const invites = myEmails.length ? await c.invites.find({ recipientEmail: { $in: myEmails }, workspaceId: { $in: foreign.map((w) => w._id) } }).sort({ createdAt: 1 }).toArray() : [];
    const inviterOf = new Map<string, string>();
    for (const inv of invites) if (!inviterOf.has(inv.workspaceId)) inviterOf.set(inv.workspaceId, inv.inviterId);
    const sharerIds = foreign.map((w) => inviterOf.get(w._id) ?? w.ownerId);
    const sharers = await c.users.find({ clerkId: { $in: Array.from(new Set(sharerIds)) } }).toArray();
    const profiles = new Map(sharers.map((u) => [u.clerkId, { name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email, email: u.email, avatar: u.imageUrl }]));

    const out: (ReturnType<typeof summary> & { workspaceName: string; sharedBy: { name: string; email: string; avatar: string | null } | null })[] = [];
    for (const workspace of foreign) {
      const sharedBy = profiles.get(inviterOf.get(workspace._id) ?? workspace.ownerId) ?? profiles.get(workspace.ownerId) ?? null;
      const slates = await c.slates
        .find({ workspaceId: workspace._id, isArchived: false }, { projection: { documentText: 0, documentJson: 0, elements: 0 } })
        .sort({ lastEdited: -1 })
        .limit(200)
        .toArray();
      for (const s of slates) out.push({ ...summary(s), workspaceName: workspace.name, sharedBy });
    }
    return await withExtras(clerkId, out.sort((a, b) => b.lastEdited - a.lastEdited));
  },
});

// Slates the user shared with others (workspaces they own that have other members)
export const listSharedByMe = query({
  handler: async (ctx) => {
    if (!ctx.userId) return [];
    const clerkId = ctx.userId;
    const c = await getCollections();
    const myWorkspaces = await c.workspaces.find({ ownerId: clerkId }).limit(100).toArray();

    const results: (ReturnType<typeof summary> & {
      workspaceName: string;
      sharedWith: { name: string; email: string | null; avatar: string | null; role: string }[];
    })[] = [];

    for (const workspace of myWorkspaces) {
      const otherMembers = await c.workspaceMembers
        .find({ workspaceId: workspace._id, userId: { $ne: clerkId } })
        .limit(50)
        .toArray();
      if (otherMembers.length === 0) continue;

      const users = await c.users.find({ clerkId: { $in: otherMembers.map((m) => m.userId) } }).toArray();
      const byId = new Map(users.map((u) => [u.clerkId, u]));
      const sharedWith = otherMembers.map((m) => {
        const user = byId.get(m.userId);
        return {
          name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email : m.userId,
          email: user?.email ?? null,
          avatar: user?.imageUrl ?? null,
          role: m.role as string,
        };
      });

      const slates = await c.slates
        .find({ workspaceId: workspace._id, isArchived: false }, { projection: { documentText: 0, documentJson: 0, elements: 0 } })
        .sort({ lastEdited: -1 })
        .limit(200)
        .toArray();
      for (const s of slates) results.push({ ...summary(s), workspaceName: workspace.name, sharedWith });
    }
    return await withExtras(clerkId, results.sort((a, b) => b.lastEdited - a.lastEdited));
  },
});
