import { z } from "zod";
import { MAX_SNAPSHOT_ELEMENTS } from "@/lib/canvas/version-snapshot";
import { normalizeElement } from "@/lib/canvas/normalize";
import type { El } from "@/lib/canvas/types";
import { getCollections } from "@/lib/db/mongo";
import type { BoardStatus, Id, SlateDoc } from "@/lib/db/types";
import { resolveAccess } from "@/lib/server/access";
import { displayName } from "@/lib/server/profile";
import type { AuthedGrant } from "./auth/verify";
import { connectorConfig } from "./config";
import { err } from "./errors";

/**
 * Data access for the connector. Tenant isolation lives HERE, in the query itself, not in the route handlers:
 * every board lookup is scoped to the grant's workspace, so an id from another workspace is simply not found
 * (404, never 403, so ids cannot be probed) no matter which endpoint asked.
 */

/** Fields every board lookup leaves out: the document body and the legacy canvas are large and rarely wanted. */
const LIGHT = { documentText: 0, documentJson: 0, elements: 0 } as const;

export const iso = (ms: number): string => new Date(ms).toISOString();

export const boardUrl = (id: string): string => `${connectorConfig().baseUrl}/canvas/${id}`;

export interface LoadedBoard {
  slate: SlateDoc;
  /** What the connected user may do with it in the app (a member of the workspace: view or edit). */
  level: "view" | "edit";
}

/**
 * The board `id` inside the connection's workspace. Missing, archived and foreign boards all look the same.
 * The app's own access resolver runs too (as the connected user), so a Viewer can never be handed edit rights.
 */
export async function loadGrantBoard(grant: AuthedGrant, id: string, opts: { need?: "view" | "edit"; withDocument?: boolean } = {}): Promise<LoadedBoard> {
  if (typeof id !== "string" || id.length === 0 || id.length > 120) throw err.notFound("Board");
  const c = await getCollections();
  const slate = await c.slates.findOne({ _id: id, workspaceId: grant.workspaceId, isArchived: false }, { projection: opts.withDocument ? { elements: 0 } : LIGHT });
  if (!slate) throw err.notFound("Board");
  const access = await resolveAccess(grant.ctx, slate);
  if (!access || access.via !== "member") throw err.notFound("Board");
  if ((opts.need ?? "view") === "edit" && access.level !== "edit") throw err.forbidden(`Your role in this workspace (${grant.role}) does not allow changing boards`);
  return { slate, level: access.level };
}

/** Names for a set of Clerk ids (one query), falling back to a neutral label. */
export async function namesFor(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const c = await getCollections();
  const users = await c.users.find({ clerkId: { $in: unique } }).toArray();
  const byId = new Map(users.map((u) => [u.clerkId, displayName(u)]));
  return new Map(unique.map((id) => [id, byId.get(id) ?? "Someone"]));
}

export type BoardStatsRow = { nodes: number; connectors: number };

export async function statsFor(ids: readonly Id<"slates">[]): Promise<Map<string, BoardStatsRow>> {
  if (ids.length === 0) return new Map();
  const c = await getCollections();
  const rows = await c.slateStats.find({ slateId: { $in: [...ids] } }).toArray();
  return new Map(rows.map((r) => [r.slateId, { nodes: r.nodes, connectors: r.connectors }]));
}

/** The shape every board has on the wire: in resources, action outputs and events alike. */
export function toBoard(slate: SlateDoc, stats: BoardStatsRow | null | undefined, statusBy?: string) {
  const status: BoardStatus = slate.status ?? "draft";
  return {
    id: slate._id,
    title: slate.title,
    status,
    linkAccess: slate.linkAccess ?? "none",
    thumbnailIcon: slate.thumbnailIcon,
    webUrl: boardUrl(slate._id),
    createdAt: iso(slate.createdAt),
    updatedAt: iso(slate.lastEdited),
    createdVia: slate.createdVia ?? "ui",
    stats: stats ?? null,
    ...(slate.statusChangedAt !== undefined ? { statusChangedAt: iso(slate.statusChangedAt) } : {}),
    ...(slate.statusChangedBy ? { statusChangedBy: { id: slate.statusChangedBy, ...(statusBy ? { name: statusBy } : {}) } } : {}),
    ...(slate.metadata ? { metadata: slate.metadata } : {}),
    ...(slate.externalRef ? { externalRef: slate.externalRef } : {}),
  };
}

export async function boardWire(slate: SlateDoc) {
  const [stats, names] = await Promise.all([statsFor([slate._id]), namesFor(slate.statusChangedBy ? [slate.statusChangedBy] : [])]);
  return toBoard(slate, stats.get(slate._id), slate.statusChangedBy ? names.get(slate.statusChangedBy) : undefined);
}

/** Every live element of a board, parsed and sanitised the same way the editor does when it loads them. */
export async function loadBoardElements(slateId: Id<"slates">): Promise<El[]> {
  const c = await getCollections();
  const rows = await c.elements
    .find({ slateId, deleted: { $ne: true } })
    .project<{ data: string; z: number }>({ data: 1, z: 1 })
    .sort({ z: 1 })
    .limit(MAX_SNAPSHOT_ELEMENTS + 1)
    .toArray();
  if (rows.length > MAX_SNAPSHOT_ELEMENTS) throw err.validation("This board is too large to read through the connector", undefined, 413);
  const out: El[] = [];
  for (const row of rows) {
    try {
      const el = normalizeElement(JSON.parse(row.data));
      if (el) out.push(el);
    } catch {
      /* one corrupt row must not hide the rest of the board */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ pagination */

/** Cursors are opaque to callers: base64url JSON, strictly validated on the way back in. */
export const encodeCursor = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

export function decodeCursor<S extends z.ZodType>(raw: string | undefined, schema: S): z.output<S> | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    /* falls through */
  }
  throw err.validation("The cursor is not valid. Start again without one.", [{ path: "cursor", message: "Invalid cursor" }]);
}

/** A page of an in-memory list, using an offset cursor. For short static lists (workspaces, templates). */
export function pageOfArray<T>(items: readonly T[], limit: number, cursor: string | undefined): { items: T[]; nextCursor: string | null } {
  const at = decodeCursor(cursor, z.object({ o: z.number().int().min(0) }))?.o ?? 0;
  const slice = items.slice(at, at + limit);
  return { items: slice, nextCursor: at + limit < items.length ? encodeCursor({ o: at + limit }) : null };
}

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
