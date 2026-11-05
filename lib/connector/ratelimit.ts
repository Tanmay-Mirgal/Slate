import { getCollections } from "@/lib/db/mongo";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends, ms since epoch. */
  resetAt: number;
  retryAfterMs: number;
}

/**
 * One step of a fixed-window limiter, kept in the database so every serverless instance shares it. It is the
 * same single atomic upsert as `lib/server/usage.ts`, but it also reports when the window ends (the
 * `X-RateLimit-Reset` header) and lives in its own collection with its own TTL.
 */
export async function takeConnectorToken(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  const c = await getCollections();
  const fresh = { $or: [{ $eq: [{ $type: "$windowStart" }, "missing"] }, { $gte: [{ $subtract: [now, "$windowStart"] }, windowMs] }] };
  const row = await c.connectorRateLimits.findOneAndUpdate(
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
  const windowStart = row?.windowStart ?? now;
  const count = row?.count ?? 1;
  const resetAt = windowStart + windowMs;
  if (count > limit) return { allowed: false, limit, remaining: 0, resetAt, retryAfterMs: Math.max(0, resetAt - now) };
  return { allowed: true, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterMs: 0 };
}
