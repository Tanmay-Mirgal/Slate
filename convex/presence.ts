import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { loadSlate, requireView, resolveAccess } from "./access";

const MAX_NAME = 60;
const MAX_DRAFT = 24_000;
const MAX_SELECTION = 60;

const cursorValidator = v.union(v.null(), v.object({ x: v.number(), y: v.number() }));
const dragValidator = v.object({ ids: v.array(v.string()), dx: v.number(), dy: v.number() });

const finite = (n: number) => (Number.isFinite(n) ? Math.max(-1e7, Math.min(1e7, n)) : 0);

/**
 * Registers a tab on a slate. Access is verified once here; `update` then only needs the
 * (unguessable) row id, which keeps the hot cursor path to a single document write.
 */
export const join = mutation({
  args: {
    slateId: v.id("slates"),
    sessionId: v.string(),
    name: v.string(),
    avatar: v.optional(v.string()),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const { access } = await requireView(ctx, args.slateId);
    const now = Date.now();
    const fields = {
      userId: access.userId ?? `anon:${args.sessionId}`,
      name: args.name.trim().slice(0, MAX_NAME) || "Guest",
      avatar: args.avatar && args.avatar.length < 500 ? args.avatar : undefined,
      color: /^#[0-9a-fA-F]{6}$/.test(args.color) ? args.color : "#6366f1",
      lastSeen: now,
    };
    const existing = await ctx.db
      .query("liveSessions")
      .withIndex("by_slate_session", (q) => q.eq("slateId", args.slateId).eq("sessionId", args.sessionId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("liveSessions", {
      slateId: args.slateId,
      sessionId: args.sessionId,
      cursor: null,
      selection: [],
      ...fields,
    });
  },
});

/** Hot path: cursor / selection / draft / drag preview. Returns false if the row was swept (client re-joins). */
export const update = mutation({
  args: {
    id: v.id("liveSessions"),
    cursor: cursorValidator,
    selection: v.array(v.string()),
    draft: v.optional(v.string()),
    drag: v.optional(dragValidator),
    tool: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return false;
    await ctx.db.patch(args.id, {
      cursor: args.cursor ? { x: finite(args.cursor.x), y: finite(args.cursor.y) } : null,
      selection: args.selection.slice(0, MAX_SELECTION).map((s) => s.slice(0, 80)),
      draft: args.draft && args.draft.length <= MAX_DRAFT ? args.draft : undefined,
      drag: args.drag
        ? { ids: args.drag.ids.slice(0, 80).map((s) => s.slice(0, 80)), dx: finite(args.drag.dx), dy: finite(args.drag.dy) }
        : undefined,
      tool: args.tool?.slice(0, 20),
      lastSeen: Date.now(),
    });
    return true;
  },
});

export const leave = mutation({
  args: { id: v.id("liveSessions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row) await ctx.db.delete(args.id);
  },
});

/** Everyone currently on the slate (the client hides its own session and fades stale ones). */
export const list = query({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await loadSlate(ctx, args.slateId);
    if (!slate || !(await resolveAccess(ctx, slate))) return [];
    const rows = await ctx.db
      .query("liveSessions")
      .withIndex("by_slate", (q) => q.eq("slateId", args.slateId))
      .take(100);
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

/** A session counts as "live" if it wrote within this window. Matches the sweep cron's cadence. */
const LIVE_WINDOW_MS = 60_000;
const MAX_SLATES_PER_CALL = 40;

/**
 * Who is on each board right now, for the dashboard cards. Only boards the caller can open are
 * answered, and the caller's own sessions are left out ("collaborators" means other people).
 */
export const activeOnSlates = query({
  args: { slateIds: v.array(v.id("slates")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const cutoff = Date.now() - LIVE_WINDOW_MS;
    const out: { slateId: (typeof args.slateIds)[number]; count: number; people: { name: string; avatar: string | null; color: string }[] }[] = [];
    for (const slateId of args.slateIds.slice(0, MAX_SLATES_PER_CALL)) {
      const slate = await loadSlate(ctx, slateId);
      if (!slate || !(await resolveAccess(ctx, slate))) continue;
      const rows = await ctx.db
        .query("liveSessions")
        .withIndex("by_slate", (q) => q.eq("slateId", slateId))
        .take(50);
      const others = new Map<string, { name: string; avatar: string | null; color: string }>();
      for (const r of rows) {
        if (r.lastSeen < cutoff || r.userId === identity.subject) continue;
        if (!others.has(r.userId)) others.set(r.userId, { name: r.name, avatar: r.avatar ?? null, color: r.color });
      }
      if (others.size > 0) out.push({ slateId, count: others.size, people: Array.from(others.values()).slice(0, 4) });
    }
    return out;
  },
});
