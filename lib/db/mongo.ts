import { randomBytes } from "node:crypto";
import { GridFSBucket, MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import type {
  BillingEventDoc,
  CommentDoc,
  CommentReadDoc,
  CommentThreadDoc,
  ElementDoc,
  InviteDoc,
  LiveSessionDoc,
  RateLimitDoc,
  SlateDoc,
  SlateFavoriteDoc,
  SlateStatsDoc,
  SlateVersionDoc,
  UserDoc,
  VersionChunkDoc,
  WorkspaceDoc,
  WorkspaceMemberDoc,
} from "./types";

/** A new document id: 24 hex characters, same shape in the browser and in URLs. */
export const newDocId = (): string => new ObjectId().toHexString();

/** An unguessable id, for rows that are addressed by id alone (live cursors, uploaded files). */
export const newSecretId = (): string => randomBytes(16).toString("hex");

export interface Collections {
  db: Db;
  users: Collection<UserDoc>;
  billingEvents: Collection<BillingEventDoc>;
  slateFavorites: Collection<SlateFavoriteDoc>;
  slateStats: Collection<SlateStatsDoc>;
  workspaces: Collection<WorkspaceDoc>;
  workspaceMembers: Collection<WorkspaceMemberDoc>;
  invites: Collection<InviteDoc>;
  slates: Collection<SlateDoc>;
  elements: Collection<ElementDoc>;
  commentThreads: Collection<CommentThreadDoc>;
  comments: Collection<CommentDoc>;
  commentReads: Collection<CommentReadDoc>;
  slateVersions: Collection<SlateVersionDoc>;
  versionChunks: Collection<VersionChunkDoc>;
  liveSessions: Collection<LiveSessionDoc>;
  rateLimits: Collection<RateLimitDoc>;
  /** Uploaded images (GridFS: `files.files` + `files.chunks`). */
  files: GridFSBucket;
}

interface Cache {
  client: MongoClient;
  ready: Promise<Collections>;
}

// Cached on globalThis so Next's dev server (which re-evaluates modules on every edit) keeps one connection pool.
const g = globalThis as unknown as { __slateMongo?: Cache };

function uri(): string {
  const value = process.env.MONGODB_URI;
  if (!value) throw new Error("MONGODB_URI is not set. Add your MongoDB connection string to .env.local.");
  return value;
}

function build(): Cache {
  const client = new MongoClient(uri(), {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
    // `undefined` fields are left out instead of being stored as null
    ignoreUndefined: true,
    appName: "slate",
  });
  const ready = (async () => {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined);
    const cols: Collections = {
      db,
      users: db.collection("users"),
      billingEvents: db.collection("billingEvents"),
      slateFavorites: db.collection("slateFavorites"),
      slateStats: db.collection("slateStats"),
      workspaces: db.collection("workspaces"),
      workspaceMembers: db.collection("workspace_members"),
      invites: db.collection("invites"),
      slates: db.collection("slates"),
      elements: db.collection("elements"),
      commentThreads: db.collection("commentThreads"),
      comments: db.collection("comments"),
      commentReads: db.collection("commentReads"),
      slateVersions: db.collection("slateVersions"),
      versionChunks: db.collection("versionChunks"),
      liveSessions: db.collection("liveSessions"),
      rateLimits: db.collection("rateLimits"),
      files: new GridFSBucket(db, { bucketName: "files" }),
    };
    await ensureIndexes(cols);
    return cols;
  })();
  // a failed connect must not poison the cache: the next request tries again
  ready.catch(() => {
    if (g.__slateMongo?.ready === ready) g.__slateMongo = undefined;
    client.close().catch(() => undefined);
  });
  return { client, ready };
}

/** The shared connection and typed collections. Safe to call on every request. */
export function getCollections(): Promise<Collections> {
  if (!g.__slateMongo) g.__slateMongo = build();
  return g.__slateMongo.ready;
}

/** Closes the pool (scripts and tests; a server never needs this). */
export async function closeMongo(): Promise<void> {
  const cache = g.__slateMongo;
  g.__slateMongo = undefined;
  if (cache) await cache.client.close();
}

/**
 * Indexes the queries rely on. `createIndex` is idempotent, so this runs once per process on first
 * use; it replaces the schema-level indexes Convex used to declare.
 */
export async function ensureIndexes(c: Collections): Promise<void> {
  const ttl = { expireAfterSeconds: 0 } as const;
  const jobs: Promise<unknown>[] = [
    c.users.createIndex({ clerkId: 1 }, { unique: true }),
    c.users.createIndex({ emails: 1 }),
    c.users.createIndex({ email: 1 }),
    c.users.createIndex({ razorpaySubscriptionId: 1 }, { sparse: true }),

    c.billingEvents.createIndex({ eventId: 1 }, { unique: true }),
    c.billingEvents.createIndex({ expireAt: 1 }, ttl),

    c.slateFavorites.createIndex({ userId: 1, slateId: 1 }, { unique: true }),
    c.slateStats.createIndex({ slateId: 1 }, { unique: true }),

    c.workspaces.createIndex({ ownerId: 1, createdAt: 1 }),
    // a user can have only one auto-created personal workspace, even if two requests race to make it
    c.workspaces.createIndex({ ownerId: 1 }, { unique: true, partialFilterExpression: { isPersonal: true }, name: "one_personal_per_owner" }),
    c.workspaceMembers.createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
    c.workspaceMembers.createIndex({ userId: 1 }),
    c.invites.createIndex({ recipientEmail: 1 }),
    c.invites.createIndex({ workspaceId: 1 }),

    c.slates.createIndex({ workspaceId: 1, isArchived: 1, lastEdited: -1 }),
    c.slates.createIndex({ userId: 1 }, { sparse: true }),

    c.elements.createIndex({ slateId: 1, eid: 1 }, { unique: true }),
    c.elements.createIndex({ slateId: 1, seq: 1 }),
    c.elements.createIndex({ slateId: 1, updatedAt: 1 }),

    c.commentThreads.createIndex({ slateId: 1, lastActivityAt: -1 }),
    c.comments.createIndex({ threadId: 1, createdAt: 1 }),
    c.commentReads.createIndex({ threadId: 1, userId: 1 }, { unique: true }),
    c.commentReads.createIndex({ slateId: 1, userId: 1 }),

    c.slateVersions.createIndex({ slateId: 1, createdAt: -1 }),
    c.versionChunks.createIndex({ versionId: 1, seq: 1 }),

    c.liveSessions.createIndex({ slateId: 1, sessionId: 1 }, { unique: true }),
    c.liveSessions.createIndex({ expireAt: 1 }, ttl),

    c.rateLimits.createIndex({ expireAt: 1 }, ttl),
  ];
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") console.error("[mongo] could not create an index:", r.reason instanceof Error ? r.reason.message : r.reason);
  }
}
