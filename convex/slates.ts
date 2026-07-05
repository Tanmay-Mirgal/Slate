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
