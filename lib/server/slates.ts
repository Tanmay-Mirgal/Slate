import { z } from "zod";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { Id, SlateDoc } from "@/lib/db/types";
import { canComment, canModerate, canViewHistory, loadSlate, membershipOf, requireEdit, requireManage, requireView, resolveAccess } from "./access";
import { assertBoardCapacity, boardLimitFailure, countOwnedBoards, tierOf } from "./billing";
import { AppError, mutation, query, zId, zLinkAccess, type Ctx } from "./fn";
import { limitsFor } from "@/lib/billing/limits";
import { ensureDefaultWorkspace } from "./users";

const MAX_DOC_CHARS = 900_000;
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

export const create = mutation({
  args: z.object({
    title: z.string().max(400),
    /** Omit to use the caller's own workspace (created on the spot for a brand-new account). */
    workspaceId: zId.optional(),
    thumbnailIcon: z.string().max(40),
  }),
  handler: async (ctx, args) => {
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
    };
    await c.slates.insertOne(doc);

    // Boards created at the same moment could all have passed the check above: settle it afterwards.
    // If that over-filled the plan, this board is taken back (so at worst a burst creates fewer than allowed, never more).
    const tier = await tierOf(workspace.ownerId);
    const limit = limitsFor(tier).maxBoards;
    if (limit !== null && (await countOwnedBoards(workspace.ownerId, limit + 1)) > limit) {
      await c.slates.deleteOne({ _id: doc._id });
      throw boardLimitFailure(tier, limit);
    }
    return doc._id;
  },
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

// Soft delete (archive)
export const remove = mutation({
  args: z.object({ id: zId }),
  handler: async (ctx, args) => {
    const { slate } = await requireManage(ctx, args.id);
    const c = await getCollections();
    await c.slates.updateOne({ _id: slate._id }, { $set: { isArchived: true, lastEdited: Date.now() } });
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
    };
  },
});

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

// "Anyone with the link" setting
export const setLinkAccess = mutation({
  args: z.object({ id: zId, linkAccess: zLinkAccess }),
  handler: async (ctx, args) => {
    const { slate } = await requireManage(ctx, args.id);
    const c = await getCollections();
    await c.slates.updateOne({ _id: slate._id }, { $set: { linkAccess: args.linkAccess } });
    return args.linkAccess;
  },
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
