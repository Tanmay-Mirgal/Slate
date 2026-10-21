import { z } from "zod";
import { getCollections, newSecretId } from "@/lib/db/mongo";
import { loadSlate, requireView, resolveAccess } from "./access";
import { mutation, query, zId } from "./fn";

const MAX_NAME = 60;
const MAX_DRAFT = 24_000;
const MAX_SELECTION = 60;
/** A session counts as "live" if it wrote within this window. */
const LIVE_WINDOW_MS = 60_000;
/** Rows are removed by MongoDB's TTL monitor this long after their last write (it runs about once a minute). */
const SESSION_TTL_MS = 90_000;
const MAX_SLATES_PER_CALL = 40;

const cursorSchema = z.union([z.null(), z.object({ x: z.number(), y: z.number() })]);
const dragSchema = z.object({ ids: z.array(z.string()), dx: z.number(), dy: z.number() });

const finite = (n: number) => (Number.isFinite(n) ? Math.max(-1e7, Math.min(1e7, n)) : 0);

/**
 * Registers a tab on a slate. Access is verified once here; `update` then only needs the
 * (unguessable) row id, which keeps the hot cursor path to a single document write.
 */
export const join = mutation({
  args: z.object({ slateId: zId, sessionId: z.string().min(1).max(80), name: z.string(), avatar: z.string().optional(), color: z.string() }),
  handler: async (ctx, args) => {
    const { access } = await requireView(ctx, args.slateId);
    const now = Date.now();
    const c = await getCollections();
    const fields = {
      userId: access.userId ?? `anon:${args.sessionId}`,
      name: args.name.trim().slice(0, MAX_NAME) || "Guest",
      avatar: args.avatar && args.avatar.length < 500 ? args.avatar : undefined,
      color: /^#[0-9a-fA-F]{6}$/.test(args.color) ? args.color : "#6366f1",
      lastSeen: now,
      expireAt: new Date(now + SESSION_TTL_MS),
    };
    const existing = await c.liveSessions.findOneAndUpdate({ slateId: args.slateId, sessionId: args.sessionId }, { $set: fields }, { returnDocument: "after" });
    if (existing) return existing._id;
    const _id = newSecretId();
    try {
      await c.liveSessions.insertOne({ _id, slateId: args.slateId, sessionId: args.sessionId, cursor: null, selection: [], ...fields });
      return _id;
    } catch (e) {
      // the same tab joined twice at once: reuse the row that won
      if ((e as { code?: number }).code !== 11000) throw e;
      const row = await c.liveSessions.findOne({ slateId: args.slateId, sessionId: args.sessionId });
      if (!row) throw e;
      return row._id;
    }
  },
});

/** Hot path: cursor / selection / draft / drag preview. Returns false if the row was swept (client re-joins). */
export const update = mutation({
  args: z.object({
    id: zId,
    cursor: cursorSchema,
    selection: z.array(z.string()),
    draft: z.string().optional(),
    drag: dragSchema.optional(),
    tool: z.string().optional(),
  }),
  handler: async (_ctx, args) => {
    const now = Date.now();
    const c = await getCollections();
    const set: Record<string, unknown> = {
      cursor: args.cursor ? { x: finite(args.cursor.x), y: finite(args.cursor.y) } : null,
      selection: args.selection.slice(0, MAX_SELECTION).map((s) => s.slice(0, 80)),
      lastSeen: now,
      expireAt: new Date(now + SESSION_TTL_MS),
    };
    const unset: Record<string, ""> = {};
    if (args.draft && args.draft.length <= MAX_DRAFT) set.draft = args.draft;
    else unset.draft = "";
    if (args.drag) set.drag = { ids: args.drag.ids.slice(0, 80).map((s) => s.slice(0, 80)), dx: finite(args.drag.dx), dy: finite(args.drag.dy) };
    else unset.drag = "";
    if (args.tool) set.tool = args.tool.slice(0, 20);
    else unset.tool = "";
    const res = await c.liveSessions.updateOne({ _id: args.id }, { $set: set, $unset: unset });
    return res.matchedCount === 1;
  },
});

export const leave = mutation({
  args: z.object({ id: zId }),
  handler: async (_ctx, args) => {
    const c = await getCollections();
    await c.liveSessions.deleteOne({ _id: args.id });
  },
});

/** Everyone currently on the slate (the client hides its own session and fades stale ones). */
export const list = query({
  args: z.object({ slateId: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.slateId);
    if (!slate || !(await resolveAccess(ctx, slate))) return [];
    const c = await getCollections();
    const rows = await c.liveSessions.find({ slateId: args.slateId, lastSeen: { $gte: Date.now() - SESSION_TTL_MS } }).limit(100).toArray();
    return rows.map((r) => ({
      sessionId: r.sessionId,
      userId: r.userId,
      name: r.name,
      avatar: r.avatar,
      color: r.color,
      cursor: r.cursor,
      selection: r.selection,
      draft: r.draft,
      drag: r.drag,
      tool: r.tool,
      lastSeen: r.lastSeen,
    }));
  },
});

/**
 * Who is on each board right now, for the dashboard cards. Only boards the caller can open are
 * answered, and the caller's own sessions are left out ("collaborators" means other people).
 */
export const activeOnSlates = query({
  args: z.object({ slateIds: z.array(zId).max(200) }),
  handler: async (ctx, args) => {
    if (!ctx.userId) return [];
    const cutoff = Date.now() - LIVE_WINDOW_MS;
    const c = await getCollections();
    const out: { slateId: string; count: number; people: { name: string; avatar: string | null; color: string }[] }[] = [];
    for (const slateId of args.slateIds.slice(0, MAX_SLATES_PER_CALL)) {
      const slate = await loadSlate(slateId);
      if (!slate || !(await resolveAccess(ctx, slate))) continue;
      const rows = await c.liveSessions.find({ slateId, lastSeen: { $gte: cutoff } }).limit(50).toArray();
      const others = new Map<string, { name: string; avatar: string | null; color: string }>();
      for (const r of rows) {
        if (r.userId === ctx.userId) continue;
        if (!others.has(r.userId)) others.set(r.userId, { name: r.name, avatar: r.avatar ?? null, color: r.color });
      }
      if (others.size > 0) out.push({ slateId, count: others.size, people: Array.from(others.values()).slice(0, 4) });
    }
    return out;
  },
});
