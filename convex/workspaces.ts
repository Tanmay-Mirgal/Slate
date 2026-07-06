import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    // Check user limits or create standard workspace
    const workspaceId = await ctx.db.insert("workspaces", {
      name: args.name,
      ownerId: clerkId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await ctx.db.insert("workspace_members", {
      workspaceId,
      userId: clerkId,
      role: "Admin",
      addedAt: Date.now(),
    });

    return workspaceId;
  },
});

export const renameWorkspace = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const membership = await ctx.db
      .query("workspace_members")
      .withIndex("by_workspaceId_userId", (q) =>
        q.eq("workspaceId", args.id).eq("userId", identity.subject)
      )
      .unique();

    if (!membership || membership.role !== "Admin") throw new Error("Unauthorized");

    await ctx.db.patch(args.id, { name: args.name.trim(), updatedAt: Date.now() });
    return args.id;
  },
});



export const listMyWorkspaces = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const clerkId = identity.subject;

    // Get all memberships for the user
    const memberships = await ctx.db
      .query("workspace_members")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .collect();

    const workspaces = await Promise.all(
      memberships.map(async (m) => {
        const workspace = await ctx.db.get(m.workspaceId);
        return {
          ...workspace,
          role: m.role,
        };
      })
    );

    return workspaces.filter((w) => w !== null);
  },
});

export const getWorkspace = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const clerkId = identity.subject;

    // Check membership
    const membership = await ctx.db
      .query("workspace_members")
      .withIndex("by_workspaceId_userId", (q) =>
        q.eq("workspaceId", args.id).eq("userId", clerkId)
      )
      .unique();

    if (!membership) {
      return null;
    }

    const workspace = await ctx.db.get(args.id);
    return { ...workspace, role: membership.role };
  },
});

export const createInvite = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recipientEmail: v.string(),
    role: v.union(v.literal("Admin"), v.literal("Editor"), v.literal("Viewer")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    // Verify inviter is Admin
    const membership = await ctx.db
      .query("workspace_members")
      .withIndex("by_workspaceId_userId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", clerkId)
      )
      .unique();

    if (!membership || membership.role !== "Admin") {
      throw new Error("Unauthorized");
    }

    const inviteId = await ctx.db.insert("invites", {
      workspaceId: args.workspaceId,
      inviterId: clerkId,
      recipientEmail: args.recipientEmail.toLowerCase(),
      role: args.role,
      status: "pending",
      createdAt: Date.now(),
    });

    return inviteId;
  },
});

export const getMyPendingInvites = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const email = identity.email;
    if (!email) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_recipientEmail", (q) => q.eq("recipientEmail", email.toLowerCase()))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const enrichedInvites = await Promise.all(
      invites.map(async (inv) => {
        const workspace = await ctx.db.get(inv.workspaceId);
        return {
          ...inv,
          workspaceName: workspace?.name,
        };
      })
    );

    return enrichedInvites;
  },
});

export const respondToInvite = mutation({
  args: {
    inviteId: v.id("invites"),
    accept: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const email = identity.email;
    const clerkId = identity.subject;
    if (!email) throw new Error("No email found");

    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.recipientEmail !== email.toLowerCase() || invite.status !== "pending") {
      throw new Error("Invalid invite");
    }

    await ctx.db.patch(args.inviteId, {
      status: args.accept ? "accepted" : "rejected",
    });

    if (args.accept) {
      // Check if membership already exists
      const existing = await ctx.db
        .query("workspace_members")
        .withIndex("by_workspaceId_userId", (q) =>
          q.eq("workspaceId", invite.workspaceId).eq("userId", clerkId)
        )
        .unique();
        
      if (!existing) {
        await ctx.db.insert("workspace_members", {
          workspaceId: invite.workspaceId,
          userId: clerkId,
          role: invite.role,
          addedAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});
