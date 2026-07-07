import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Helper function to check if a user has access to a workspace.
// Returns null for legacy slates that pre-date the workspace system.
async function checkWorkspaceAccess(ctx: any, workspaceId: string | undefined, clerkId: string) {
  if (!workspaceId) return null;
  const membership = await ctx.db
    .query("workspace_members")
    .withIndex("by_workspaceId_userId", (q: any) =>
      q.eq("workspaceId", workspaceId).eq("userId", clerkId)
    )
    .unique();
  return membership;
}

// Get all slates for a specific workspace
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const clerkId = identity.subject;

    const membership = await checkWorkspaceAccess(ctx, args.workspaceId, clerkId);
    if (!membership) {
      return [];
    }

    const slates = await ctx.db
      .query("slates")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    return slates.sort((a, b) => b.lastEdited - a.lastEdited);
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
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    const membership = await checkWorkspaceAccess(ctx, args.workspaceId, clerkId);
    if (!membership || membership.role === "Viewer") {
      throw new Error("Unauthorized to create slates in this workspace");
    }

    // Checking user plan limits can be done based on user plan (skipping for brevity but retaining structure)
    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
      
    const slateId = await ctx.db.insert("slates", {
      title: args.title,
      workspaceId: args.workspaceId,
      isArchived: false,
      lastEdited: Date.now(),
      thumbnailIcon: args.thumbnailIcon,
    });

    return slateId;
  },
});

// Rename a slate
export const rename = mutation({
  args: {
    id: v.id("slates"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const clerkId = identity.subject;

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Slate not found");

    const membership = await checkWorkspaceAccess(ctx, existing.workspaceId, clerkId);
    if (!membership || membership.role === "Viewer") throw new Error("Unauthorized");

    await ctx.db.patch(args.id, {
      title: args.title,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Delete a slate (soft-delete / archive)
export const remove = mutation({
  args: {
    id: v.id("slates"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const clerkId = identity.subject;

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Slate not found");

    const membership = await checkWorkspaceAccess(ctx, existing.workspaceId, clerkId);
    if (!membership || membership.role === "Viewer") throw new Error("Unauthorized");

    await ctx.db.patch(args.id, {
      isArchived: true,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Get a single slate by ID
export const getById = query({
  args: { id: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await ctx.db.get(args.id);
    if (!slate || slate.isArchived) {
      return null;
    }
    
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    
    const membership = await checkWorkspaceAccess(ctx, slate.workspaceId, identity.subject);
    if (!membership) return null;

    return slate;
  },
});

// Update canvas elements
export const updateElements = mutation({
  args: {
    id: v.id("slates"),
    elements: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Slate not found");
    
    const membership = await checkWorkspaceAccess(ctx, existing.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") throw new Error("Unauthorized");

    await ctx.db.patch(args.id, {
      elements: args.elements,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Atomically add a single element
export const addElement = mutation({
  args: {
    id: v.id("slates"),
    element: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return args.id;
    
    const slate = await ctx.db.get(args.id);
    if (!slate) return args.id;
    
    const membership = await checkWorkspaceAccess(ctx, slate.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") return args.id;

    let currentEls: any[] = [];
    if (slate.elements) {
      try {
        currentEls = JSON.parse(slate.elements);
      } catch (e) {}
    }

    try {
      const newEl = JSON.parse(args.element);
      const exists = currentEls.some((el: any) => el.id === newEl.id);
      if (!exists) {
        currentEls.push(newEl);
        await ctx.db.patch(args.id, {
          elements: JSON.stringify(currentEls),
          lastEdited: Date.now(),
        });
      }
    } catch (e) {}

    return args.id;
  },
});

// Atomically remove a single element by ID
export const removeElement = mutation({
  args: {
    id: v.id("slates"),
    elementId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return args.id;
    
    const slate = await ctx.db.get(args.id);
    if (!slate || !slate.elements) return args.id;

    const membership = await checkWorkspaceAccess(ctx, slate.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") return args.id;

    try {
      const currentEls = JSON.parse(slate.elements);
      const filtered = currentEls.filter((el: any) => el.id !== args.elementId);
      await ctx.db.patch(args.id, {
        elements: JSON.stringify(filtered),
        lastEdited: Date.now(),
      });
    } catch (e) {}

    return args.id;
  },
});

// Atomically update a single element by ID
export const updateElement = mutation({
  args: {
    id: v.id("slates"),
    elementId: v.string(),
    updates: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return args.id;
    
    const slate = await ctx.db.get(args.id);
    if (!slate || !slate.elements) return args.id;

    const membership = await checkWorkspaceAccess(ctx, slate.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") return args.id;

    try {
      const currentEls = JSON.parse(slate.elements);
      const updates = JSON.parse(args.updates);
      const index = currentEls.findIndex((el: any) => el.id === args.elementId);
      
      if (index !== -1) {
        currentEls[index] = { ...currentEls[index], ...updates };
        await ctx.db.patch(args.id, {
          elements: JSON.stringify(currentEls),
          lastEdited: Date.now(),
        });
      }
    } catch (e) {}

    return args.id;
  },
});

// Atomically update multiple elements at once
export const updateMultipleElements = mutation({
  args: {
    id: v.id("slates"),
    updatesList: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return args.id;
    
    const slate = await ctx.db.get(args.id);
    if (!slate || !slate.elements) return args.id;

    const membership = await checkWorkspaceAccess(ctx, slate.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") return args.id;

    try {
      const currentEls = JSON.parse(slate.elements);
      const updatesList = JSON.parse(args.updatesList);
      
      let changed = false;
      updatesList.forEach((updateItem: any) => {
        const index = currentEls.findIndex((el: any) => el.id === updateItem.id);
        if (index !== -1) {
          currentEls[index] = { ...currentEls[index], ...updateItem.updates };
          changed = true;
        }
      });

      if (changed) {
        await ctx.db.patch(args.id, {
          elements: JSON.stringify(currentEls),
          lastEdited: Date.now(),
        });
      }
    } catch (e) {}

    return args.id;
  },
});

// Update document markdown text
export const updateDocument = mutation({
  args: {
    id: v.id("slates"),
    documentText: v.string(),
    documentJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Slate not found");
    
    const membership = await checkWorkspaceAccess(ctx, existing.workspaceId, identity.subject);
    if (!membership || membership.role === "Viewer") throw new Error("Unauthorized");

    await ctx.db.patch(args.id, {
      documentText: args.documentText,
      documentJson: args.documentJson,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Update real-time multiplayer presence (cursor position & status)
export const updatePresence = mutation({
  args: {
    slateId: v.id("slates"),
    userId: v.string(),
    userName: v.string(),
    userAvatar: v.optional(v.string()),
    cursorX: v.number(),
    cursorY: v.number(),
    drawingElement: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_slateId", (q) => q.eq("slateId", args.slateId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userName: args.userName,
        userAvatar: args.userAvatar,
        cursorX: args.cursorX,
        cursorY: args.cursorY,
        drawingElement: args.drawingElement,
        lastSeen: now,
      });
    } else {
      await ctx.db.insert("presence", {
        slateId: args.slateId,
        userId: args.userId,
        userName: args.userName,
        userAvatar: args.userAvatar,
        cursorX: args.cursorX,
        cursorY: args.cursorY,
        drawingElement: args.drawingElement,
        lastSeen: now,
      });
    }
  },
});

// Query active presence for a slate (active within the last 15 seconds)
export const getPresence = query({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - 15000;
    const list = await ctx.db
      .query("presence")
      .withIndex("by_slateId", (q) => q.eq("slateId", args.slateId))
      .filter((q) => q.gte(q.field("lastSeen"), cutoff))
      .collect();

    return list;
  },
});

// List slates shared WITH the user (workspaces where they are member but not owner)
// Includes inviter profile info for "Shared by" display
export const listShared = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const clerkId = identity.subject;
    const myEmail = identity.email?.toLowerCase();

    const memberships = await ctx.db
      .query("workspace_members")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .collect();

    const sharedSlates: any[] = [];
    for (const m of memberships) {
      const workspace = await ctx.db.get(m.workspaceId);
      if (!workspace || workspace.ownerId === clerkId) continue;

      // Find the invite that brought this user into the workspace
      let sharedByProfile: any = null;
      if (myEmail) {
        const invite = await ctx.db
          .query("invites")
          .withIndex("by_recipientEmail", (q) => q.eq("recipientEmail", myEmail))
          .filter((q) => q.eq(q.field("workspaceId"), m.workspaceId))
          .first();

        if (invite) {
          const inviterUser = await ctx.db
            .query("users")
            .withIndex("by_clerkId", (q) => q.eq("clerkId", invite.inviterId))
            .unique();
          if (inviterUser) {
            sharedByProfile = {
              name: [inviterUser.firstName, inviterUser.lastName].filter(Boolean).join(" ") || inviterUser.email,
              email: inviterUser.email,
              avatar: inviterUser.imageUrl,
            };
          }
        }
      }

      // Fallback: look up owner profile
      if (!sharedByProfile) {
        const ownerUser = await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", workspace.ownerId))
          .unique();
        if (ownerUser) {
          sharedByProfile = {
            name: [ownerUser.firstName, ownerUser.lastName].filter(Boolean).join(" ") || ownerUser.email,
            email: ownerUser.email,
            avatar: ownerUser.imageUrl,
          };
        }
      }

      const slates = await ctx.db
        .query("slates")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", m.workspaceId))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .collect();

      slates.forEach((s) => {
        sharedSlates.push({
          ...s,
          workspaceName: workspace.name,
          sharedBy: sharedByProfile,
        });
      });
    }

    return sharedSlates.sort((a, b) => b.lastEdited - a.lastEdited);
  },
});

// List slates the user has shared with others (workspaces they own that have other members)
export const listSharedByMe = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const clerkId = identity.subject;

    const myWorkspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", clerkId))
      .collect();

    const results: any[] = [];

    for (const workspace of myWorkspaces) {
      // Get members other than the owner
      const otherMembers = await ctx.db
        .query("workspace_members")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
        .filter((q) => q.neq(q.field("userId"), clerkId))
        .collect();

      if (otherMembers.length === 0) continue;

      // Enrich member profiles
      const sharedWith = await Promise.all(
        otherMembers.map(async (m) => {
          const user = await ctx.db
            .query("users")
            .withIndex("by_clerkId", (q) => q.eq("clerkId", m.userId))
            .unique();
          return {
            name: user ? ([user.firstName, user.lastName].filter(Boolean).join(" ") || user.email) : m.userId,
            email: user?.email ?? null,
            avatar: user?.imageUrl ?? null,
            role: m.role,
          };
        })
      );

      const slates = await ctx.db
        .query("slates")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .collect();

      slates.forEach((s) => {
        results.push({
          ...s,
          workspaceName: workspace.name,
          sharedWith,
        });
      });
    }

    return results.sort((a, b) => b.lastEdited - a.lastEdited);
  },
});
