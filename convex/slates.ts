import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { loadSlate, requireEdit, requireManage, resolveAccess } from "./access";

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
    return slates.map(summary);
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
    };
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
    return out.sort((a, b) => b.lastEdited - a.lastEdited);
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
    return results.sort((a, b) => b.lastEdited - a.lastEdited);
  },
});
