import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Where a comment thread is pinned. See `Anchor` in commentLogic.ts. */
const anchorValidator = v.union(
  v.object({ kind: v.literal("point"), x: v.number(), y: v.number() }),
  v.object({ kind: v.literal("element"), eid: v.string(), u: v.number(), v: v.number(), x: v.number(), y: v.number() })
);

const mentionValidator = v.object({ userId: v.string(), name: v.string() });

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
  }).index("by_ownerId", ["ownerId"]),

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
    workspaceId: v.optional(v.id("workspaces")),
    isArchived: v.boolean(),
    lastEdited: v.number(),
    thumbnailIcon: v.string(),
    /** "Anyone with the link" permission. Missing == "none". */
    linkAccess: v.optional(v.union(v.literal("none"), v.literal("view"), v.literal("edit"))),
    /** 2 = canvas elements live in the `elements` table. */
    schemaVersion: v.optional(v.number()),
    /** When the last automatic version snapshot was scheduled (see versions.ts). */
    lastAutoVersionAt: v.optional(v.number()),
    documentText: v.optional(v.string()),
    documentJson: v.optional(v.string()),
    /**
     * Legacy (schema v1): the entire canvas as one JSON string. Read once by the client, converted
     * and moved into the `elements` table by `elements.importLegacy`, then removed.
     */
    elements: v.optional(v.string()),
    // Legacy fields from the pre-workspace schema (kept for backward compatibility)
    userId: v.optional(v.string()),
    isShared: v.optional(v.boolean()),
  })
    .index("by_workspaceId", ["workspaceId"])
    // ordered, filtered listing without scanning archived slates
    .index("by_workspace_active", ["workspaceId", "isArchived", "lastEdited"]),

  /**
   * One row per canvas element. Rows are spread over SHARD_COUNT shards so a client subscribes to
   * N small queries instead of one large one, and a single change re-sends ~1/N of the board.
   */
  elements: defineTable({
    slateId: v.id("slates"),
    eid: v.string(),
    shard: v.number(),
    z: v.number(),
    rev: v.number(),
    /** JSON of the element (small: images are stored as URLs, not data URIs). */
    data: v.string(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  })
    .index("by_slate_shard", ["slateId", "shard"])
    .index("by_slate_eid", ["slateId", "eid"]),

  /**
   * Comment threads pinned to a canvas point or to an element. The first message lives in `comments`
   * like every reply; the summary fields (`snippet`, `replyCount`, ...) are denormalised so the
   * thread list never has to read every message.
   */
  commentThreads: defineTable({
    slateId: v.id("slates"),
    anchor: anchorValidator,
    status: v.union(v.literal("open"), v.literal("resolved")),
    authorId: v.string(), // clerk subject
    authorName: v.string(),
    authorAvatar: v.optional(v.string()),
    createdAt: v.number(),
    lastActivityAt: v.number(),
    lastActivityBy: v.string(),
    replyCount: v.number(),
    snippet: v.string(),
    /** Everyone @mentioned anywhere in the thread (drives the "mentions you" badge). */
    mentionedIds: v.array(v.string()),
    resolvedAt: v.optional(v.number()),
    resolvedByName: v.optional(v.string()),
  }).index("by_slate_activity", ["slateId", "lastActivityAt"]),

  comments: defineTable({
    threadId: v.id("commentThreads"),
    slateId: v.id("slates"),
    authorId: v.string(),
    authorName: v.string(),
    authorAvatar: v.optional(v.string()),
    body: v.string(),
    mentions: v.array(mentionValidator),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  }).index("by_thread", ["threadId"]),

  /** When each user last opened each thread (drives the unread badge). One row per user and thread. */
  commentReads: defineTable({
    slateId: v.id("slates"),
    threadId: v.id("commentThreads"),
    userId: v.string(),
    readAt: v.number(),
  })
    .index("by_slate_user", ["slateId", "userId"])
    .index("by_thread_user", ["threadId", "userId"]),

  /** Version history: one row per saved version of a board, the payload lives in `versionChunks`. */
  slateVersions: defineTable({
    slateId: v.id("slates"),
    kind: v.union(v.literal("manual"), v.literal("auto")),
    label: v.optional(v.string()),
    createdAt: v.number(),
    authorId: v.optional(v.string()),
    authorName: v.optional(v.string()),
    elementCount: v.number(),
    bytes: v.number(),
    chunkCount: v.number(),
    /** Content fingerprint, used to skip automatic versions of an unchanged board. */
    hash: v.string(),
  }).index("by_slate", ["slateId", "createdAt"]),

  /** The snapshot itself: one JSON array of elements cut into ~200k-character pieces (see snapshot.ts). */
  versionChunks: defineTable({
    versionId: v.id("slateVersions"),
    slateId: v.id("slates"),
    seq: v.number(),
    data: v.string(),
  }).index("by_version", ["versionId", "seq"]),

  /** Live collaboration state (cursors, selections, drafts). Short lived; swept by a cron. */
  liveSessions: defineTable({
    slateId: v.id("slates"),
    sessionId: v.string(),
    userId: v.string(),
    name: v.string(),
    avatar: v.optional(v.string()),
    color: v.string(),
    cursor: v.union(v.null(), v.object({ x: v.number(), y: v.number() })),
    selection: v.array(v.string()),
    draft: v.optional(v.string()),
    drag: v.optional(v.object({ ids: v.array(v.string()), dx: v.number(), dy: v.number() })),
    tool: v.optional(v.string()),
    lastSeen: v.number(),
  })
    .index("by_slate", ["slateId"])
    .index("by_slate_session", ["slateId", "sessionId"])
    .index("by_lastSeen", ["lastSeen"]),

  /** Fixed-window rate limiter used by the AI endpoint (works across serverless instances). */
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  /** Deprecated: replaced by `liveSessions`. Left in the schema so old rows still validate; a cron drains it. */
  presence: defineTable({
    slateId: v.id("slates"),
    userId: v.string(),
    userName: v.string(),
    userAvatar: v.optional(v.string()),
    cursorX: v.number(),
    cursorY: v.number(),
    drawingElement: v.optional(v.string()),
    lastSeen: v.number(),
  }).index("by_slateId", ["slateId"]),
});
