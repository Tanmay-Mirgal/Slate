import { PLANS, type PlanLimits, type Tier } from "./plans";

/**
 * Gatekeepers: pure functions that decide what a subscription entitles its owner to. The Convex
 * mutations call these inside the same transaction that writes, so a cap can't be raced past, and
 * the UI calls them to explain a refusal. Nothing here touches a database or the network.
 */

const DAY = 24 * 60 * 60 * 1000;

/** How long a paid plan keeps working after its period end, to ride out a delayed renewal webhook. */
export const RENEWAL_GRACE_MS = 3 * DAY;
/** AI credits refill every 30 days from the first use, whatever the billing interval (annual plans too). */
export const CREDIT_PERIOD_MS = 30 * DAY;

export type SubscriptionStatus = "active" | "halted" | "cancelled" | "pending";

export interface SubscriptionFields {
  subscriptionTier?: Tier;
  subscriptionStatus?: SubscriptionStatus;
  razorpayCurrentPeriodEnd?: number;
}

export interface CreditFields {
  aiCreditsUsedThisPeriod?: number;
  aiCreditsPeriodStart?: number;
}

export function limitsFor(tier: Tier): PlanLimits {
  return PLANS[tier].limits;
}

/**
 * The tier a user can actually use right now. The stored tier is a record of what they paid for;
 * this decides whether it still applies:
 *   - pending / halted payments never grant access
 *   - a cancelled plan works until the period it was paid for ends
 *   - an active plan whose period ended long ago (missed renewal) lapses back to free
 */
export function effectiveTier(user: SubscriptionFields | null | undefined, now = Date.now()): Tier {
  const tier = user?.subscriptionTier ?? "free";
  if (tier === "free") return "free";
  const status = user?.subscriptionStatus ?? "pending";
  const end = user?.razorpayCurrentPeriodEnd;
  if (status === "pending" || status === "halted") return "free";
  if (status === "cancelled") return end !== undefined && now <= end ? tier : "free";
  if (end !== undefined && now > end + RENEWAL_GRACE_MS) return "free";
  return tier;
}

export interface BoardCheck {
  allowed: boolean;
  /** `null` = unlimited. */
  limit: number | null;
  used: number;
  remaining: number | null;
}

export function checkBoardLimit(tier: Tier, activeBoards: number): BoardCheck {
  const limit = limitsFor(tier).maxBoards;
  if (limit === null) return { allowed: true, limit, used: activeBoards, remaining: null };
  return { allowed: activeBoards < limit, limit, used: activeBoards, remaining: Math.max(0, limit - activeBoards) };
}

export interface CreditState {
  used: number;
  periodStart: number;
}

/** Applies the rolling refill: a period older than CREDIT_PERIOD_MS starts over at zero. */
export function normalizeCredits(fields: CreditFields | null | undefined, now = Date.now()): CreditState {
  const start = fields?.aiCreditsPeriodStart;
  if (start === undefined || now - start >= CREDIT_PERIOD_MS || start > now) return { used: 0, periodStart: now };
  return { used: Math.max(0, fields?.aiCreditsUsedThisPeriod ?? 0), periodStart: start };
}

export interface CreditCheck {
  allowed: boolean;
  cap: number;
  used: number;
  remaining: number;
  /** When the counter next resets. */
  resetsAt: number;
}

export function checkAiCredit(tier: Tier, fields: CreditFields | null | undefined, now = Date.now(), cost = 1): CreditCheck {
  const cap = limitsFor(tier).aiCreditsMonthly;
  const state = normalizeCredits(fields, now);
  return {
    allowed: state.used + cost <= cap,
    cap,
    used: state.used,
    remaining: Math.max(0, cap - state.used),
    resetsAt: state.periodStart + CREDIT_PERIOD_MS,
  };
}

/** Machine-readable reasons a gate can refuse. Shared by the Convex errors and the API responses. */
export type BillingErrorCode = "board_limit" | "credits_exhausted";

// A type alias (not an interface) so it is assignable to Convex's `Value` for ConvexError payloads.
export type BillingErrorData = {
  code: BillingErrorCode;
  message: string;
  tier: Tier;
  limit: number | null;
};

export function boardLimitError(tier: Tier, check: BoardCheck): BillingErrorData {
  return {
    code: "board_limit",
    message: `The ${PLANS[tier].name} plan includes ${check.limit} boards and you've used all of them. Upgrade to Pro for unlimited boards.`,
    tier,
    limit: check.limit,
  };
}

export function creditsError(tier: Tier, check: CreditCheck): BillingErrorData {
  return {
    code: "credits_exhausted",
    message: `You've used all ${check.cap} AI credits on the ${PLANS[tier].name} plan this month. They refill on ${new Date(check.resetsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, or upgrade for more.`,
    tier,
    limit: check.cap,
  };
}

/** Narrow type guard for error payloads that crossed the network (Convex `ConvexError.data`, API JSON). */
export function isBillingErrorData(value: unknown): value is BillingErrorData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.code === "board_limit" || v.code === "credits_exhausted") && typeof v.message === "string";
}
