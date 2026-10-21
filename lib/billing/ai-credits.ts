import { refundAiCredit as refund, reserveAiCredit as reserve } from "@/lib/server/billing";
import { creditsError, type BillingErrorData } from "./limits";
import type { Tier } from "./plans";

/**
 * AI credit gate for the API routes. Credits are reserved before the model is called (atomically,
 * in the database, against the caller's plan) and handed back if the generation fails, so a user is
 * only charged for diagrams they actually received.
 */

export type Reservation =
  | { ok: true; tier: Tier; used: number; cap: number; remaining: number }
  | { ok: false; reason: "exhausted"; error: BillingErrorData; resetsAt: number }
  | { ok: false; reason: "unavailable"; message: string };

export async function reserveAiCredit(userId: string, cost = 1): Promise<Reservation> {
  try {
    const r = await reserve(userId, cost);
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
    await refund(clerkId, cost);
  } catch (e) {
    console.error("[ai-credits] refund failed", e);
  }
}
