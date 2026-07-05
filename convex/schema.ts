import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.union(v.string(), v.null()),
    lastName: v.union(v.string(), v.null()),
    imageUrl: v.union(v.string(), v.null()),
  })
  .index("by_clerkId", ["clerkId"]),

  slates: defineTable({
    title: v.string(),
    userId: v.string(),
    isArchived: v.boolean(),
    isShared: v.boolean(),
    lastEdited: v.number(),
    thumbnailIcon: v.string(),
    elements: v.optional(v.string()),
  })
  .index("by_userId", ["userId"]),
});
