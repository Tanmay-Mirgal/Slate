import { getCollections } from "@/lib/db/mongo";

export interface TokenResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * One step of a fixed-window rate limiter: takes a token for `userId` in `bucket`, or reports when the
 * window reopens. A single atomic upsert, so the limit holds across every serverless instance. Rows
 * expire on their own (TTL index). Used by the AI / billing routes and by comments.
 */
export async function takeToken(userId: string, bucket: string, limitIn: number, windowMsIn: number): Promise<TokenResult> {
  const c = await getCollections();
  const limit = Math.max(1, Math.min(10_000, Math.floor(limitIn)));
  const windowMs = Math.max(1000, Math.min(86_400_000, Math.floor(windowMsIn)));
  const key = `${userId}:${bucket.slice(0, 40)}`;
  const now = Date.now();

  // a missing row, or one whose window has passed, starts a new window at 1
  const fresh = { $or: [{ $eq: [{ $type: "$windowStart" }, "missing"] }, { $gte: [{ $subtract: [now, "$windowStart"] }, windowMs] }] };
  const row = await c.rateLimits.findOneAndUpdate(
    { _id: key },
    [
      {
        $set: {
          count: { $cond: [fresh, 1, { $add: [{ $ifNull: ["$count", 0] }, 1] }] },
          windowStart: { $cond: [fresh, now, "$windowStart"] },
          expireAt: { $cond: [fresh, new Date(now + windowMs + 60_000), "$expireAt"] },
        },
      },
    ],
    { upsert: true, returnDocument: "after" }
  );
  if (!row) return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  if (row.count > limit) return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, row.windowStart + windowMs - now) };
  return { allowed: true, remaining: Math.max(0, limit - row.count), retryAfterMs: 0 };
}
