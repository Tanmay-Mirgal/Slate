import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";

export interface TokenResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * One step of the fixed-window limiter: takes a token for `userId` in `bucket`, or reports when the
 * window reopens. Shared by `consume` (called by the Next.js API routes) and by backend functions
 * that need to bound what one user can write (e.g. comments).
 */
export async function takeToken(ctx: MutationCtx, userId: string, bucket: string, limitIn: number, windowMsIn: number): Promise<TokenResult> {
  const limit = Math.max(1, Math.min(10_000, Math.floor(limitIn)));
  const windowMs = Math.max(1000, Math.min(86_400_000, Math.floor(windowMsIn)));
  const key = `${userId}:${bucket.slice(0, 40)}`;
  const now = Date.now();

  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (row.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, row.windowStart + windowMs - now) };
  }
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return { allowed: true, remaining: limit - row.count - 1, retryAfterMs: 0 };
}

/**
 * Fixed-window rate limiter keyed by the authenticated user. Lives in the database (not process
 * memory) so the limit holds across serverless instances. Called by the Next.js API routes with
 * the caller's own Clerk token; the key is derived from that identity, never from the arguments.
 */
export const consume = mutation({
  args: {
    bucket: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await takeToken(ctx, identity.subject, args.bucket, args.limit, args.windowMs);
  },
});
