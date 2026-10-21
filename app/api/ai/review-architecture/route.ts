import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { generateReview } from "@/lib/ai/review";
import { AiError, nvidiaConfig } from "@/lib/ai/nvidia";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { refundAiCredit, reserveAiCredit } from "@/lib/billing/ai-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  dsl: z.string().max(14000),
  checklist: z
    .array(z.object({ section: z.string().max(80), item: z.string().max(220), done: z.boolean(), note: z.string().max(520) }))
    .max(80),
  notes: z.string().max(6000).optional(),
});

function json(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * POST /api/ai/review-architecture
 * Grades the diagram + checklist + notes of a system design interview against the rubric. Costs one
 * AI credit, refunded if the model produced nothing usable.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return json(401, "unauthenticated", "Sign in to get an AI review.");
  if (Number(req.headers.get("content-length") ?? 0) > 60_000) return json(413, "too_large", "That request is too large.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return json(400, "bad_request", e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid request" : "Invalid request body");
  }
  if (!body.dsl.trim()) return json(400, "empty_board", "Draw your architecture first, then ask for a review.");

  const cfg = nvidiaConfig();
  if (!cfg.apiKey) return json(503, "not_configured", "AI review isn't set up yet. Add NVIDIA_API_KEY (free at build.nvidia.com) to your environment.");

  const limit = await checkAiRateLimit(userId);
  if (!limit.allowed) {
    const secs = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return json(429, "rate_limited", limit.scope === "burst" ? "Slow down for a few seconds." : "You've reached the hourly AI limit. Try again later.", { retryAfterSeconds: secs }, { "Retry-After": String(secs) });
  }

  const credit = await reserveAiCredit(userId);
  if (!credit.ok) {
    if (credit.reason === "exhausted") return json(402, credit.error.code, credit.error.message, { tier: credit.error.tier, limit: credit.error.limit, resetsAt: credit.resetsAt });
    return json(503, "billing_unavailable", credit.message);
  }

  try {
    const { review, model } = await generateReview(body, cfg, req.signal);
    return Response.json({ review, model, credits: { used: credit.used, cap: credit.cap, remaining: credit.remaining } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    await refundAiCredit(userId);
    const err = e instanceof AiError ? e : new AiError("upstream", "Unexpected error while reviewing the design");
    if (!(e instanceof AiError)) console.error("[ai/review-architecture]", e);
    const status = err.code === "rate_limited" ? 429 : err.code === "bad_key" || err.code === "not_configured" ? 503 : err.code === "aborted" ? 499 : 502;
    return json(status, err.code, err.message, err.retryAfterMs ? { retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000) } : {});
  }
}
