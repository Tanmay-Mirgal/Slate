/**
 * Document shapes of the MongoDB collections. Types only (no runtime imports), so client components
 * can import them without pulling the database driver into the browser bundle.
 *
 * Every document is keyed by a string `_id`. Documents created before the move from Convex keep their
 * original Convex ids, so existing `/canvas/<id>` links keep working; new ones get an ObjectId hex string.
 */

/** A document id. The table name is documentation only (it keeps call sites readable). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Id<_Table extends string = string> = string;

export type Role = "Admin" | "Editor" | "Viewer";
export type LinkAccess = "none" | "view" | "edit";
export type Tier = "free" | "pro" | "team";
export type SubscriptionStatus = "active" | "halted" | "cancelled" | "pending";
export type BillingInterval = "monthly" | "annual";

export type Anchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "element"; eid: string; u: number; v: number; x: number; y: number };

export interface UserDoc {
  _id: Id<"users">;
  clerkId: string;
  /** Primary email address ("" when Clerk has none). */
  email: string;
  /** Every verified address, lower-cased. Invitations match against any of them. */
  emails?: string[];
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  plan?: string;
  paymentId?: string;

  /* ---- Razorpay billing (written only by billing.syncSubscription / the AI credit gate) ---- */
  subscriptionTier?: Tier;
  subscriptionStatus?: SubscriptionStatus;
  billingInterval?: BillingInterval;
  subscriptionSeats?: number;
  razorpayCustomerId?: string;
  razorpaySubscriptionId?: string;
  razorpayPlanId?: string;
  /** End of the period that has been paid for, ms since epoch. */
  razorpayCurrentPeriodEnd?: number;
  aiCreditsMonthlyCap?: number;
  aiCreditsUsedThisPeriod?: number;
  /** Start of the current 30-day credit period, ms since epoch. */
  aiCreditsPeriodStart?: number;

  createdAt: number;
  updatedAt?: number;
}

/** Razorpay webhook deliveries already applied, so a retried delivery is a no-op. */
export interface BillingEventDoc {
  _id: Id<"billingEvents">;
  eventId: string;
  type: string;
  processedAt: number;
  /** TTL: MongoDB removes the row once this date passes. */
  expireAt: Date;
}

export interface SlateFavoriteDoc {
  _id: Id<"slateFavorites">;
  userId: string;
  slateId: Id<"slates">;
  createdAt: number;
}

/** Node / connector counts shown on dashboard cards. Reported by an editing client. */
export interface SlateStatsDoc {
  _id: Id<"slateStats">;
  slateId: Id<"slates">;
  nodes: number;
  connectors: number;
  updatedAt: number;
}

export interface WorkspaceDoc {
  _id: Id<"workspaces">;
  name: string;
  ownerId: string;
  /** The workspace every user gets on first sign-in. At most one per owner. */
  isPersonal?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMemberDoc {
  _id: Id<"workspace_members">;
  workspaceId: Id<"workspaces">;
  userId: string;
  role: Role;
  addedAt: number;
}

export interface InviteDoc {
  _id: Id<"invites">;
  workspaceId: Id<"workspaces">;
  inviterId: string;
  recipientEmail: string;
  role: Role;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
}

export interface SlateDoc {
  _id: Id<"slates">;
  title: string;
  workspaceId?: Id<"workspaces">;
  isArchived: boolean;
  createdAt: number;
  lastEdited: number;
  thumbnailIcon: string;
  /** "Anyone with the link" permission. Missing == "none". */
  linkAccess?: LinkAccess;
  /** 2 = canvas elements live in the `elements` collection. */
  schemaVersion?: number;
  /** When the last automatic version snapshot was scheduled (see versions.ts). */
  lastAutoVersionAt?: number;
  /** Highest change sequence number handed out to an element of this board (see elements.ts). */
  elementSeq?: number;
  /** Deleted-element markers with a sequence number at or below this have been purged. */
  tombstoneFloor?: number;
  documentText?: string;
  documentJson?: string;
  /** Legacy (schema v1): the whole canvas as one JSON string. Converted into `elements` rows by the first editor. */
  elements?: string;
  /** Legacy fields from the pre-workspace schema. */
  userId?: string;
  isShared?: boolean;
}

/** One row per canvas element (or a tombstone for a deleted one, so other clients learn about the delete). */
export interface ElementDoc {
  _id: Id<"elements">;
  slateId: Id<"slates">;
  eid: string;
  /** Per-board change counter: clients ask for everything after the last one they saw. */
  seq: number;
  z: number;
  rev: number;
  /** JSON of the element (small: images are stored as URLs, not data URIs). Empty for tombstones. */
  data: string;
  deleted?: boolean;
  updatedAt: number;
  updatedBy?: string;
}

export interface MentionDoc {
  userId: string;
  name: string;
}

export interface CommentThreadDoc {
  _id: Id<"commentThreads">;
  slateId: Id<"slates">;
  anchor: Anchor;
  status: "open" | "resolved";
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  createdAt: number;
  lastActivityAt: number;
  lastActivityBy: string;
  replyCount: number;
  snippet: string;
  mentionedIds: string[];
  resolvedAt?: number;
  resolvedByName?: string;
}

export interface CommentDoc {
  _id: Id<"comments">;
  threadId: Id<"commentThreads">;
  slateId: Id<"slates">;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  body: string;
  mentions: MentionDoc[];
  createdAt: number;
  editedAt?: number;
}

export interface CommentReadDoc {
  _id: Id<"commentReads">;
  slateId: Id<"slates">;
  threadId: Id<"commentThreads">;
  userId: string;
  readAt: number;
}

export interface SlateVersionDoc {
  _id: Id<"slateVersions">;
  slateId: Id<"slates">;
  kind: "manual" | "auto";
  label?: string;
  createdAt: number;
  authorId?: string;
  authorName?: string;
  elementCount: number;
  bytes: number;
  chunkCount: number;
  /** Content fingerprint, used to skip automatic versions of an unchanged board. */
  hash: string;
}

export interface VersionChunkDoc {
  _id: Id<"versionChunks">;
  versionId: Id<"slateVersions">;
  slateId: Id<"slates">;
  seq: number;
  data: string;
}

/** Live collaboration state (cursors, selections, drafts). Short lived; MongoDB's TTL monitor sweeps it. */
export interface LiveSessionDoc {
  _id: Id<"liveSessions">;
  slateId: Id<"slates">;
  sessionId: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
  draft?: string;
  drag?: { ids: string[]; dx: number; dy: number };
  tool?: string;
  lastSeen: number;
  expireAt: Date;
}

/** Fixed-window rate limiter used by the AI, billing and comment endpoints (works across serverless instances). */
export interface RateLimitDoc {
  /** `${userId}:${bucket}` */
  _id: string;
  windowStart: number;
  count: number;
  expireAt: Date;
}
