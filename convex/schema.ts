import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.union(v.string(), v.null()),
    lastName: v.union(v.string(), v.null()),
    imageUrl: v.union(v.string(), v.null()),
    plan: v.optional(v.string()),
    paymentId: v.optional(v.string()),
  })
  .index("by_clerkId", ["clerkId"])
  .index("by_email", ["email"]),

  workspaces: defineTable({
    name: v.string(),
    ownerId: v.string(), // clerkId
    createdAt: v.number(),
    updatedAt: v.number(),
  })
  .index("by_ownerId", ["ownerId"]),

  workspace_members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(), // clerkId
    role: v.union(v.literal("Admin"), v.literal("Editor"), v.literal("Viewer")),
    addedAt: v.number(),
  })
  .index("by_workspaceId", ["workspaceId"])
  .index("by_userId", ["userId"])
  .index("by_workspaceId_userId", ["workspaceId", "userId"]),

  invites: defineTable({
    workspaceId: v.id("workspaces"),
    inviterId: v.string(), // clerkId
    recipientEmail: v.string(),
    role: v.union(v.literal("Admin"), v.literal("Editor"), v.literal("Viewer")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected")),
    createdAt: v.number(),
  })
  .index("by_recipientEmail", ["recipientEmail"])
  .index("by_workspaceId", ["workspaceId"]),

  slates: defineTable({
    title: v.string(),
    workspaceId: v.id("workspaces"),
    isArchived: v.boolean(),
    lastEdited: v.number(),
    thumbnailIcon: v.string(),
    elements: v.optional(v.string()),
    documentText: v.optional(v.string()),
  })
  .index("by_workspaceId", ["workspaceId"]),

  presence: defineTable({
    slateId: v.id("slates"),
    userId: v.string(),
    userName: v.string(),
    userAvatar: v.optional(v.string()),
    cursorX: v.number(),
    cursorY: v.number(),
    drawingElement: v.optional(v.string()),
    lastSeen: v.number(),
  })
  .index("by_slateId", ["slateId"]),
});

