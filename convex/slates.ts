import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get all slates for the logged-in user
export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const clerkId = identity.subject;

    const slates = await ctx.db
      .query("slates")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Sort by lastEdited descending
    return slates.sort((a, b) => b.lastEdited - a.lastEdited);
  },
});

// Create a new slate
export const create = mutation({
  args: {
    title: v.string(),
    thumbnailIcon: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    const slateId = await ctx.db.insert("slates", {
      title: args.title,
      userId: clerkId,
      isArchived: false,
      isShared: false,
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
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    const existing = await ctx.db.get(args.id);
    if (!existing || existing.userId !== clerkId) {
      throw new Error("Unauthorized");
    }

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
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    const existing = await ctx.db.get(args.id);
    if (!existing || existing.userId !== clerkId) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.id, {
      isArchived: true,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Toggle share status of a slate
export const toggleShare = mutation({
  args: {
    id: v.id("slates"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    const existing = await ctx.db.get(args.id);
    if (!existing || existing.userId !== clerkId) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.id, {
      isShared: !existing.isShared,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Get a single slate by ID
export const getById = query({
  args: { id: v.id("slates") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const slate = await ctx.db.get(args.id);
    if (!slate || slate.isArchived) {
      return null;
    }

    // Allow access if owner or shared
    if (slate.userId !== identity.subject && !slate.isShared) {
      return null;
    }

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
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Slate not found");
    }

    await ctx.db.patch(args.id, {
      elements: args.elements,
      lastEdited: Date.now(),
    });

    return args.id;
  },
});

// Update document markdown text
export const updateDocument = mutation({
  args: {
    id: v.id("slates"),
    documentText: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Slate not found");
    }

    await ctx.db.patch(args.id, {
      documentText: args.documentText,
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
