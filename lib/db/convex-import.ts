/**
 * Pure mapping from rows of a Convex snapshot export (`npx convex export`) to MongoDB documents.
 * No I/O, so it is unit-tested; `scripts/migrate-convex-to-mongo.ts` does the reading and writing.
 *
 * Convex ids are kept as the MongoDB `_id`, so every id stored inside other documents (slateId,
 * workspaceId, threadId, ...) and every `/canvas/<id>` URL stays valid without rewriting.
 */

export type Row = Record<string, unknown>;

/** Tables copied across, in the order they are written (parents before the rows that point at them). */
export const COPIED_TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "invites",
  "slates",
  "slateStats",
  "slateFavorites",
  "elements",
  "commentThreads",
  "comments",
  "commentReads",
  "slateVersions",
  "versionChunks",
  "billingEvents",
] as const;

export type CopiedTable = (typeof COPIED_TABLES)[number];

/** Convex table -> MongoDB collection (only `workspace_members` is renamed). */
export const COLLECTION_OF: Record<CopiedTable, string> = {
  users: "users",
  workspaces: "workspaces",
  workspace_members: "workspace_members",
  invites: "invites",
  slates: "slates",
  slateStats: "slateStats",
  slateFavorites: "slateFavorites",
  elements: "elements",
  commentThreads: "commentThreads",
  comments: "comments",
  commentReads: "commentReads",
  slateVersions: "slateVersions",
  versionChunks: "versionChunks",
  billingEvents: "billingEvents",
};

/** Short-lived or deprecated state that is not worth carrying over (cursors, rate-limit windows, the old presence table). */
export const SKIPPED_TABLES = ["liveSessions", "presence", "rateLimits"] as const;

const BILLING_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Convex stores times as floating point milliseconds. */
const wholeMs = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : Date.now());

export class BadRow extends Error {}

/**
 * Maps one exported row. Returns null for a row that should not be copied (reason in `skip`).
 * `elements` get their `seq` from the caller (it numbers them per board).
 */
export function mapRow(table: CopiedTable, row: Row, now = Date.now()): { doc: Row } | { skip: string } {
  const id = asString(row._id);
  if (!id) throw new BadRow(`${table}: row without an _id`);
  const { _creationTime, _id, ...rest } = row;
  void _id;
  const created = wholeMs(_creationTime);
  const doc: Row = { _id: id, ...rest };

  switch (table) {
    case "users": {
      const email = asString(row.email) ?? "";
      if (!asString(row.clerkId)) throw new BadRow(`users/${id}: no clerkId`);
      doc.email = email;
      doc.emails = email ? [email.trim().toLowerCase()] : [];
      doc.createdAt = created;
      doc.updatedAt = created;
      break;
    }
    case "slates":
      doc.createdAt = created;
      break;
    case "elements": {
      delete doc.shard; // sharding is gone: clients read a change feed instead
      if (!asString(row.slateId) || !asString(row.eid)) throw new BadRow(`elements/${id}: missing slateId or eid`);
      break;
    }
    case "billingEvents": {
      const processedAt = typeof row.processedAt === "number" ? row.processedAt : created;
      doc.expireAt = new Date(processedAt + BILLING_EVENT_TTL_MS);
      if ((doc.expireAt as Date).getTime() < now) return { skip: "delivery id older than the retention window" };
      break;
    }
    default:
      break; // every other table keeps exactly the fields it had
  }
  return { doc };
}

/** A link into Convex file storage. The source deployment had none; if an export ever does, the migration stops instead of leaving dead links behind. */
export const CONVEX_STORAGE_URL = /https?:\/\/[a-z0-9-]+\.convex\.(?:cloud|site)\/api\/storage\//;
