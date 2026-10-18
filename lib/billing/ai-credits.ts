import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { creditsError, type BillingErrorData } from "./limits";
import type { Tier } from "./plans";
import { syncSecret } from "./razorpay";

/**
 * AI credit gate for the API routes. Credits are reserved before the model is called (atomically,
 * in Convex, against the caller's plan) and handed back if the generation fails, so a user is only
 * charged for diagrams they actually received.
 */

export type Reservation =
  | { ok: true; tier: Tier; used: number; cap: number; remaining: number }
  | { ok: false; reason: "exhausted"; error: BillingErrorData; resetsAt: number }
  | { ok: false; reason: "unavailable"; message: string };

export async function reserveAiCredit(token: string | null, cost = 1): Promise<Reservation> {
  if (!token) return { ok: false, reason: "unavailable", message: "Couldn't verify your plan. Sign out and back in, then try again." };
  try {
    const r = await fetchMutation(api.billing.reserveAiCredit, { cost }, { token });
    if (r.ok) return { ok: true, tier: r.tier, used: r.used, cap: r.cap, remaining: r.remaining };
    return { ok: false, reason: "exhausted", resetsAt: r.resetsAt, error: creditsError(r.tier, { allowed: false, cap: r.cap, used: r.used, remaining: r.remaining, resetsAt: r.resetsAt }) };
  } catch (e) {
    console.error("[ai-credits] reserve failed", e);
    return { ok: false, reason: "unavailable", message: "Couldn't check your AI credits right now. Please try again." };
  }
}

/** Best effort: a failed refund is logged, never surfaced over the real error. */
export async function refundAiCredit(clerkId: string, cost = 1): Promise<void> {
  try {
    await fetchMutation(api.billing.refundAiCredit, { secret: syncSecret(), clerkId, cost });
  } catch (e) {
    console.error("[ai-credits] refund failed", e);
  }
}
