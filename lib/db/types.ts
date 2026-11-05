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

  /* ---- ecosystem connector (all optional: boards without them are exactly as before) ---- */
  /** Review state used by the connected Hub: a design is drafted, reviewed, then approved. Missing == "draft". */
  status?: BoardStatus;
  statusChangedAt?: number;
  statusChangedBy?: string;
  /** Caller-defined data (<= 2 KB) set by a connected app, echoed back by the connector. */
  metadata?: Record<string, unknown>;
  /** Correlation ids from the Hub's workflow run, echoed in every event about this board. */
  externalRef?: ExternalRef;
  createdVia?: "ui" | "connector";
}

export type BoardStatus = "draft" | "in_review" | "approved";

export interface ExternalRef {
  hubProjectId?: string;
  hubRunId?: string;
  hubStepId?: string;
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

/* ------------------------------------------------------------------ ecosystem connector */

/** One user's consent for one app, pinned to one workspace. Tokens are stored only as HMACs. */
export interface ConnectorGrantDoc {
  _id: Id<"connector_grants">;
  clientId: string;
  /** The Clerk user the app acts as. Their current role in the workspace caps every request. */
  userId: string;
  workspaceId: Id<"workspaces">;
  scopes: string[];
  accessHash: string;
  /** ms since epoch */
  accessExpiresAt: number;
  refreshHash: string;
  /** Every refresh token issued for this grant belongs to the same family (the grant itself). */
  refreshFamilyId: string;
  refreshExpiresAt: number;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  revokedReason?: string;
}

export interface ConnectorCodeDoc {
  /** HMAC of the authorization code. */
  _id: string;
  clientId: string;
  userId: string;
  workspaceId: Id<"workspaces">;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  /** ms since epoch; a code is only redeemable until then. */
  expiresAt: number;
  usedAt?: number;
  /** The grant minted from this code; revoked when the code is presented a second time. */
  grantId?: string;
  /** Set when the code was presented again after it had been redeemed. */
  reused?: boolean;
  /** TTL: kept after use so a replay can still be recognised. */
  expireAt: Date;
}

/** Refresh tokens that were already rotated away. Presenting one again means the family leaked. */
export interface ConnectorUsedRefreshDoc {
  /** HMAC of the retired refresh token. */
  _id: string;
  grantId: string;
  expireAt: Date;
}

export interface ConnectorWebhookDoc {
  _id: Id<"connector_webhooks">;
  grantId: string;
  workspaceId: Id<"workspaces">;
  url: string;
  /** Exact event types or `prefix.*` patterns. */
  events: string[];
  description?: string;
  /** AES-256-GCM, see crypto.ts. Needed to sign, so it cannot be hashed. */
  secretEnc: string;
  status: "active" | "disabled";
  disabledReason?: string;
  disabledAt?: number;
  consecutiveFailures: number;
  firstFailureAt?: number;
  lastDeliveryAt?: number;
  lastDeliveryStatus?: "succeeded" | "failed";
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorEventDoc {
  /** ULID: sorts by time. */
  _id: string;
  workspaceId: Id<"workspaces">;
  type: string;
  occurredAt: number;
  /** Monotonic per workspace; what `GET /events?cursor=` pages by. */
  cursor: number;
  actor: { id: string; name: string; kind: "user" | "system" | "connector" };
  externalRef?: ExternalRef;
  data: Record<string, unknown>;
  boardId?: Id<"slates">;
  /** Set while the dispatcher has not created deliveries for the event yet (the outbox queue). */
  pending?: true;
  fannedOutAt?: number;
  expireAt: Date;
}

export interface ConnectorDeliveryDoc {
  _id: string;
  eventId: string;
  webhookId: Id<"connector_webhooks">;
  grantId: string;
  workspaceId: Id<"workspaces">;
  eventType: string;
  /** Sent as X-CP-Delivery; stable across retries. */
  deliveryUuid: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  nextAttemptAt: number;
  /** Claimed by a worker until this time (prevents two dispatchers sending the same attempt). */
  leaseUntil?: number;
  lastStatusCode?: number;
  lastError?: string;
  lastBody?: string;
  lastAttemptAt?: number;
  createdAt: number;
  expireAt: Date;
}

export interface ConnectorOperationDoc {
  _id: string;
  grantId: string;
  workspaceId: Id<"workspaces">;
  action: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  input: Record<string, unknown>;
  /** What the action's `accept` step prepared for the worker (ids it created, credits it took...). */
  state?: Record<string, unknown>;
  requestId?: string;
  output?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
  /** AI credits taken when the operation was accepted; handed back once if it fails. */
  creditsReserved?: number;
  creditsRefunded?: boolean;
  /** A worker holds the operation until then; an expired lease means the worker died. */
  leaseUntil?: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  expireAt: Date;
}

export interface ConnectorIdempotencyDoc {
  /** `${grantId}:${key}` */
  _id: string;
  requestHash: string;
  state: "in_progress" | "done";
  status?: number;
  body?: string;
  createdAt: number;
  expireAt: Date;
}

export interface ConnectorAuditDoc {
  _id: string;
  at: number;
  grantId: string;
  clientId: string;
  workspaceId: Id<"workspaces">;
  userId: string;
  via: "connector";
  method: string;
  /** Route pattern or action name; never request payloads. */
  route: string;
  status: number;
  requestId: string;
  durationMs: number;
  expireAt: Date;
}

export interface ConnectorRateLimitDoc {
  _id: string;
  windowStart: number;
  count: number;
  expireAt: Date;
}

/** Per-workspace counter behind `connector_events.cursor`. */
export interface ConnectorCounterDoc {
  _id: string;
  seq: number;
}
