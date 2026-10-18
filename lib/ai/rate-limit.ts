import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export interface LimitResult {
  allowed: boolean;
  retryAfterMs: number;
  scope?: "burst" | "hour";
}

const BURST = { bucket: "ai-burst", limit: 6, windowMs: 60_000 };

function hourly() {
  const n = Number(process.env.AI_RATE_LIMIT_PER_HOUR);
  return { bucket: "ai-hour", limit: Number.isFinite(n) && n > 0 ? Math.floor(n) : 40, windowMs: 3_600_000 };
}

/** Per-instance fallback used only if Convex is unreachable, so an outage can't open the floodgates. */
const memory = new Map<string, { start: number; count: number }>();
function memoryLimit(userId: string, b: { bucket: string; limit: number; windowMs: number }): LimitResult {
  const key = `${userId}:${b.bucket}`;
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || now - cur.start >= b.windowMs) {
    memory.set(key, { start: now, count: 1 });
    if (memory.size > 5000) for (const [k, v] of memory) if (now - v.start >= 3_600_000) memory.delete(k);
    return { allowed: true, retryAfterMs: 0 };
  }
  if (cur.count >= b.limit) return { allowed: false, retryAfterMs: cur.start + b.windowMs - now };
  cur.count++;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Two fixed windows per user: a short burst cap and an hourly cap. Stored in Convex so the limit is
 * shared by every serverless instance; falls back to process memory if Convex can't be reached.
 */
export async function checkAiRateLimit(userId: string, token: string | null): Promise<LimitResult> {
  const buckets: [typeof BURST, "burst" | "hour"][] = [
    [BURST, "burst"],
    [hourly(), "hour"],
  ];
  for (const [b, scope] of buckets) {
    let res: LimitResult;
    try {
      if (!token) throw new Error("no token");
      const r = await fetchMutation(api.usage.consume, { bucket: b.bucket, limit: b.limit, windowMs: b.windowMs }, { token });
      res = { allowed: r.allowed, retryAfterMs: r.retryAfterMs };
    } catch {
      res = memoryLimit(userId, b);
    }
    if (!res.allowed) return { ...res, scope };
  }
  return { allowed: true, retryAfterMs: 0 };
}
