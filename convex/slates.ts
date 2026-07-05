import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get all slates for the logged-in user (including shared slates)
export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      const publicShared = await ctx.db
        .query("slates")
        .filter((q) => q.and(q.eq(q.field("isArchived"), false), q.eq(q.field("isShared"), true)))
        .collect();
      return publicShared.sort((a, b) => b.lastEdited - a.lastEdited);
    }

    const clerkId = identity.subject;

    const mySlates = await ctx.db
      .query("slates")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const sharedSlates = await ctx.db
      .query("slates")
      .filter((q) => q.and(q.eq(q.field("isArchived"), false), q.eq(q.field("isShared"), true)))
      .collect();

    const map = new Map();
    mySlates.forEach((s) => map.set(s._id, s));
    sharedSlates.forEach((s) => map.set(s._id, s));

    const allSlates = Array.from(map.values());
    return allSlates.sort((a, b) => b.lastEdited - a.lastEdited);
  },
});

// Create a new slate (enforces Free Plan 3-slate limit)
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

    // Check user plan limits
    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();

    const plan = userRecord?.plan || "FREE";

    if (plan === "FREE") {
      const existingSlates = await ctx.db
        .query("slates")
        .withIndex("by_userId", (q) => q.eq("userId", clerkId))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .collect();

      if (existingSlates.length >= 3) {
        throw new Error("FREE_LIMIT_REACHED: Starter plan limit reached (3/3 slates). Upgrade to PRO or MAX via Razorpay for unlimited slates!");
      }
    }

    const slateId = await ctx.db.insert("slates", {
      title: args.title,
      userId: clerkId,
      isArchived: false,
      isShared: true,
      lastEdited: Date.now(),
      thumbnailIcon: args.thumbnailIcon,
    });

    return slateId;
  },
});

// Upgrade user plan after successful Razorpay payment
export const upgradePlan = mutation({
  args: {
    plan: v.string(),
    paymentId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }

    const clerkId = identity.subject;

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();

    if (existingUser) {
      await ctx.db.patch(existingUser._id, {
        plan: args.plan,
        paymentId: args.paymentId,
      });
    } else {
      await ctx.db.insert("users", {
        clerkId,
        email: identity.email || "",
        firstName: identity.givenName || null,
        lastName: identity.familyName || null,
        imageUrl: identity.pictureUrl || null,
        plan: args.plan,
        paymentId: args.paymentId,
      });
    }

    return { success: true, plan: args.plan };
  },
});

// Get user subscription plan and applied feature limits
export const getUserPlan = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { plan: "FREE", maxSlates: 3, storageMb: 100, isPro: false, isMax: false };
    }

    const clerkId = identity.subject;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();

    const plan = user?.plan || "FREE";
    const isPro = plan === "PRO" || plan === "MAX";
    const isMax = plan === "MAX";

    return {
      plan,
      paymentId: user?.paymentId,
      maxSlates: isPro ? 9999 : 3,
      storageMb: isMax ? 102400 : isPro ? 10240 : 100,
      isPro,
      isMax,
    };
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
    const slate = await ctx.db.get(args.id);
    if (!slate || slate.isArchived) {
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

// Atomically add a single element to a slate without overwriting existing elements
export const addElement = mutation({
  args: {
    id: v.id("slates"),
    element: v.string(),
  },
  handler: async (ctx, args) => {
    const slate = await ctx.db.get(args.id);
    if (!slate) return args.id;

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
    } catch (e) {
      console.error("Failed adding element", e);
    }

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
    const slate = await ctx.db.get(args.id);
    if (!slate || !slate.elements) return args.id;

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

// Update document markdown text
export const updateDocument = mutation({
  args: {
    id: v.id("slates"),
    documentText: v.string(),
  },
  handler: async (ctx, args) => {
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
