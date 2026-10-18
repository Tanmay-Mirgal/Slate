import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { canComment, canModerate, canViewHistory, loadSlate, requireEdit, requireManage, requireView, resolveAccess } from "./access";
import { assertBoardCapacity } from "./billing";

const MAX_DOC_CHARS = 900_000;

/** Lightweight shape for lists: never ship canvas / document bodies to the dashboard. */
function summary(s: Doc<"slates">) {
  return {
    _id: s._id,
    _creationTime: s._creationTime,
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
async function withExtras<T extends { _id: Id<"slates"> }>(ctx: QueryCtx, userId: string, rows: T[]): Promise<(T & DashboardExtras)[]> {
  const favorites = await ctx.db
    .query("slateFavorites")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(1000);
  const starred = new Set<Id<"slates">>(favorites.map((f) => f.slateId));
  return await Promise.all(
    rows.map(async (row) => {
      const stats = await ctx.db
        .query("slateStats")
        .withIndex("by_slate", (q) => q.eq("slateId", row._id))
        .unique();
      return { ...row, isFavorite: starred.has(row._id), nodeCount: stats?.nodes ?? null, connectorCount: stats?.connectors ?? null };
    })
  );
}

async function membershipOf(ctx: { db: import("./_generated/server").QueryCtx["db"] }, workspaceId: Doc<"workspaces">["_id"], clerkId: string) {
  return await ctx.db
    .query("workspace_members")
    .withIndex("by_workspaceId_userId", (q) => q.eq("workspaceId", workspaceId).eq("userId", clerkId))
    .unique();
}

// Active slates of a workspace, newest first.
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    if (!(await membershipOf(ctx, args.workspaceId, identity.subject))) return [];
    const slates = await ctx.db
      .query("slates")
      .withIndex("by_workspace_active", (q) => q.eq("workspaceId", args.workspaceId).eq("isArchived", false))
      .order("desc")
      .take(500);
    return await withExtras(ctx, identity.subject, slates.map(summary));
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    workspaceId: v.id("workspaces"),
    thumbnailIcon: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const membership = await membershipOf(ctx, args.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") throw new Error("Unauthorized to create slates in this workspace");

    // The workspace owner's plan decides how many boards fit (throws ConvexError { code: "board_limit" }).
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    await assertBoardCapacity(ctx, workspace.ownerId);

    return await ctx.db.insert("slates", {
      title: args.title.trim().slice(0, 120) || "Untitled",
      workspaceId: args.workspaceId,
      isArchived: false,
      lastEdited: Date.now(),
      thumbnailIcon: args.thumbnailIcon,
      linkAccess: "none",
      schemaVersion: 2,
    });
  },
});

export const rename = mutation({
  args: { id: v.id("slates"), title: v.string() },
  handler: async (ctx, args) => {
    const { slate } = await requireManage(ctx, args.id);
    await ctx.db.patch(slate._id, { title: args.title.trim().slice(0, 120) || "Untitled", lastEdited: Date.now() });
    return args.id;
  },
});

// Soft delete (archive)
export const remove = mutation({
  args: { id: v.id("slates") },
  handler: async (ctx, args) => {
    const { slate } = await requireManage(ctx, args.id);
    await ctx.db.patch(slate._id, { isArchived: true, lastEdited: Date.now() });
    return args.id;
  },
});

/**
 * A slate plus what the caller may do with it. Works for signed-out visitors when link sharing is
 * on. Returns null (never throws) when the slate is missing or the caller has no access.
 */
export const getById = query({
  args: { id: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await loadSlate(ctx, args.id);
    if (!slate) return null;
    const access = await resolveAccess(ctx, slate);
    if (!access) return null;
    return {
      _id: slate._id,
      title: slate.title,
      workspaceId: slate.workspaceId,
      lastEdited: slate.lastEdited,
      linkAccess: slate.linkAccess ?? "none",
      documentText: slate.documentText,
      documentJson: slate.documentJson,
      /** Present only for un-migrated schema-v1 boards; the client imports then clears it. */
      legacyElements: slate.elements,
      access: access.level,
      canManage: access.via !== "link" && access.level === "edit",
      /** See the collaboration rules in access.ts. */
      canComment: canComment(access),
      canModerate: canModerate(access),
      canViewHistory: canViewHistory(access),
      stats: await statsOf(ctx, slate._id),
    };
  },
});

async function statsOf(ctx: QueryCtx, slateId: Id<"slates">) {
  const row = await ctx.db
    .query("slateStats")
    .withIndex("by_slate", (q) => q.eq("slateId", slateId))
    .unique();
  return row ? { nodes: row.nodes, connectors: row.connectors } : null;
}

/** Star / unstar a board for the caller. Anyone who can open the board can star it. */
export const setFavorite = mutation({
  args: { id: v.id("slates"), favorite: v.boolean() },
  handler: async (ctx, args) => {
    const { access } = await requireView(ctx, args.id);
    if (!access.userId) throw new Error("Sign in to star boards");
    const userId = access.userId;
    const existing = await ctx.db
      .query("slateFavorites")
      .withIndex("by_user_slate", (q) => q.eq("userId", userId).eq("slateId", args.id))
      .unique();
    if (args.favorite && !existing) await ctx.db.insert("slateFavorites", { userId, slateId: args.id, createdAt: Date.now() });
    if (!args.favorite && existing) await ctx.db.delete(existing._id);
    return args.favorite;
  },
});

/**
 * An editing client reports how many nodes and connectors the board has so dashboard cards can show
 * them without loading every element. Cheap and idempotent: unchanged counts write nothing.
 */
export const reportStats = mutation({
  args: { id: v.id("slates"), nodes: v.number(), connectors: v.number() },
  handler: async (ctx, args) => {
    await requireEdit(ctx, args.id);
    const clamp = (n: number) => Math.max(0, Math.min(1_000_000, Math.floor(Number.isFinite(n) ? n : 0)));
    const nodes = clamp(args.nodes);
    const connectors = clamp(args.connectors);
    const row = await ctx.db
      .query("slateStats")
      .withIndex("by_slate", (q) => q.eq("slateId", args.id))
      .unique();
    if (!row) await ctx.db.insert("slateStats", { slateId: args.id, nodes, connectors, updatedAt: Date.now() });
    else if (row.nodes !== nodes || row.connectors !== connectors) await ctx.db.patch(row._id, { nodes, connectors, updatedAt: Date.now() });
    return { nodes, connectors };
  },
});

// "Anyone with the link" setting
export const setLinkAccess = mutation({
  args: { id: v.id("slates"), linkAccess: v.union(v.literal("none"), v.literal("view"), v.literal("edit")) },
  handler: async (ctx, args) => {
    const { slate } = await requireManage(ctx, args.id);
    await ctx.db.patch(slate._id, { linkAccess: args.linkAccess });
    return args.linkAccess;
  },
});

// Rich-text document that lives next to the canvas
export const updateDocument = mutation({
  args: {
    id: v.id("slates"),
    documentText: v.string(),
    documentJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { slate } = await requireEdit(ctx, args.id);
    if (args.documentText.length > MAX_DOC_CHARS || (args.documentJson?.length ?? 0) > MAX_DOC_CHARS) {
      throw new Error("Document is too large");
    }
    await ctx.db.patch(slate._id, {
      documentText: args.documentText,
      documentJson: args.documentJson,
      lastEdited: Date.now(),
    });
    return args.id;
  },
});

// Slates shared WITH the user (workspaces where they are a member but not the owner)
export const listShared = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const clerkId = identity.subject;
    const myEmail = identity.email?.toLowerCase();

    const memberships = await ctx.db
      .query("workspace_members")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .take(100);

    const out: (ReturnType<typeof summary> & { workspaceName: string; sharedBy: { name: string; email: string; avatar: string | null } | null })[] = [];
    for (const m of memberships) {
      const workspace = await ctx.db.get(m.workspaceId);
      if (!workspace || workspace.ownerId === clerkId) continue;

      let sharedBy: { name: string; email: string; avatar: string | null } | null = null;
      const profileOf = async (id: string) => {
        const u = await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", id))
          .unique();
        return u ? { name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email, email: u.email, avatar: u.imageUrl } : null;
      };
      if (myEmail) {
        const invite = await ctx.db
          .query("invites")
          .withIndex("by_recipientEmail", (q) => q.eq("recipientEmail", myEmail))
          .filter((q) => q.eq(q.field("workspaceId"), m.workspaceId))
          .first();
        if (invite) sharedBy = await profileOf(invite.inviterId);
      }
      if (!sharedBy) sharedBy = await profileOf(workspace.ownerId);

      const slates = await ctx.db
        .query("slates")
        .withIndex("by_workspace_active", (q) => q.eq("workspaceId", m.workspaceId).eq("isArchived", false))
        .order("desc")
        .take(200);
      for (const s of slates) out.push({ ...summary(s), workspaceName: workspace.name, sharedBy });
    }
    return await withExtras(ctx, clerkId, out.sort((a, b) => b.lastEdited - a.lastEdited));
  },
});

// Slates the user shared with others (workspaces they own that have other members)
export const listSharedByMe = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const clerkId = identity.subject;

    const myWorkspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", clerkId))
      .take(100);

    const results: (ReturnType<typeof summary> & {
      workspaceName: string;
      sharedWith: { name: string; email: string | null; avatar: string | null; role: string }[];
    })[] = [];

    for (const workspace of myWorkspaces) {
      const otherMembers = await ctx.db
        .query("workspace_members")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
        .filter((q) => q.neq(q.field("userId"), clerkId))
        .take(50);
      if (otherMembers.length === 0) continue;

      const sharedWith = await Promise.all(
        otherMembers.map(async (m) => {
          const user = await ctx.db
            .query("users")
            .withIndex("by_clerkId", (q) => q.eq("clerkId", m.userId))
            .unique();
          return {
            name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email : m.userId,
            email: user?.email ?? null,
            avatar: user?.imageUrl ?? null,
            role: m.role as string,
          };
        })
      );

      const slates = await ctx.db
        .query("slates")
        .withIndex("by_workspace_active", (q) => q.eq("workspaceId", workspace._id).eq("isArchived", false))
        .order("desc")
        .take(200);
      for (const s of slates) results.push({ ...summary(s), workspaceName: workspace.name, sharedWith });
    }
    return await withExtras(ctx, clerkId, results.sort((a, b) => b.lastEdited - a.lastEdited));
  },
});
