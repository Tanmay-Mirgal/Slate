import { internalMutation } from "./_generated/server";

const SESSION_TTL_MS = 90_000;
const RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/** Drops cursors of tabs that closed without calling `presence.leave` (crash, sleep, lost network). */
export const sweepSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    const stale = await ctx.db
      .query("liveSessions")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", cutoff))
      .take(BATCH);
    for (const row of stale) await ctx.db.delete(row._id);

    // Drain the deprecated presence table (rows from before liveSessions existed).
    const legacy = await ctx.db.query("presence").take(BATCH);
    for (const row of legacy) await ctx.db.delete(row._id);
    return { sessions: stale.length, legacy: legacy.length };
  },
});

export const sweepRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RATE_LIMIT_TTL_MS;
    const rows = await ctx.db.query("rateLimits").take(500);
    let removed = 0;
    for (const row of rows) {
      if (row.windowStart < cutoff) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return { removed };
  },
});
