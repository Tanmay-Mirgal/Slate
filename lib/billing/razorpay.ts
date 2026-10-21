import Razorpay from "razorpay";
import { syncSubscription, type SyncSubscriptionInput } from "@/lib/server/billing";
import type { Interval, PaidTier } from "./plans";

/** Server-only helpers shared by the three Razorpay routes. Never import this from client code. */

export class BillingConfigError extends Error {}

export function razorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new BillingConfigError("Razorpay isn't configured. Set RAZORPAY_KEY_ID (or NEXT_PUBLIC_RAZORPAY_KEY_ID) and RAZORPAY_KEY_SECRET.");
  return { keyId, keySecret };
}

let client: Razorpay | null = null;
export function getRazorpay(): Razorpay {
  if (!client) {
    const { keyId, keySecret } = razorpayKeys();
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return client;
}

/**
 * Razorpay plan ids for subscription billing. Plans are created once in the Razorpay dashboard;
 * when one isn't configured the checkout falls back to a one-time order for the first period.
 */
export function planIdFor(tier: PaidTier, interval: Interval): string | null {
  const key = `RAZORPAY_PLAN_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  const v = process.env[key]?.trim();
  return v || null;
}

/** Reverse lookup used by webhooks when a subscription's notes are missing. */
export function tierForPlanId(planId: string | undefined | null): { tier: PaidTier; interval: Interval } | null {
  if (!planId) return null;
  for (const tier of ["pro", "team"] as PaidTier[]) {
    for (const interval of ["monthly", "annual"] as Interval[]) {
      if (planIdFor(tier, interval) === planId) return { tier, interval };
    }
  }
  return null;
}

/** Billing period length for one-time orders, in ms. */
export function periodMs(interval: Interval): number {
  return (interval === "annual" ? 365 : 30) * 24 * 60 * 60 * 1000;
}

export type SyncInput = SyncSubscriptionInput;

/** Writes a verified billing state into the database. */
export async function syncToDatabase(input: SyncInput) {
  return await syncSubscription(input);
}

export function parseNotes(notes: unknown): { clerkId?: string; tier?: PaidTier; interval?: Interval; seats?: number } {
  if (!notes || typeof notes !== "object") return {};
  const n = notes as Record<string, unknown>;
  const tier = n.tier === "pro" || n.tier === "team" ? n.tier : undefined;
  const interval = n.interval === "monthly" || n.interval === "annual" ? n.interval : undefined;
  const seats = Number(n.seats);
  return {
    clerkId: typeof n.clerkId === "string" && n.clerkId ? n.clerkId : undefined,
    tier,
    interval,
    seats: Number.isFinite(seats) && seats > 0 ? Math.floor(seats) : undefined,
  };
}
