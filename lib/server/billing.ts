import { getCollections, newDocId } from "@/lib/db/mongo";
import type { BillingInterval, SubscriptionStatus, Tier, UserDoc } from "@/lib/db/types";
import { boardLimitError, checkAiCredit, checkBoardLimit, CREDIT_PERIOD_MS, effectiveTier, limitsFor } from "@/lib/billing/limits";
import { AppError, query, type Ctx } from "./fn";
import { ensureUser, upsertUser, type ProfileInput, type ProfileSource } from "./users";

/*
 * Billing state lives on the user document. Functions that grant plans or refund credits are plain
 * server functions (not RPC endpoints): only the Razorpay routes and the AI routes, running on the
 * server after they verified the payment / the session, can reach them.
 */

/* ------------------------------------------------------------------ helpers */

export async function userByClerkId(clerkId: string): Promise<UserDoc | null> {
  const c = await getCollections();
  return await c.users.findOne({ clerkId });
}

/** The tier a clerk user can use right now (free when we have no row for them). */
export async function tierOf(clerkId: string, now = Date.now()): Promise<Tier> {
  return effectiveTier(await userByClerkId(clerkId), now);
}

/** Active boards in the workspaces `ownerClerkId` owns. Stops counting at `stopAt`, which is all a cap check needs. */
export async function countOwnedBoards(ownerClerkId: string, stopAt = 5000): Promise<number> {
  const c = await getCollections();
  const workspaces = await c.workspaces.find({ ownerId: ownerClerkId }).project<{ _id: string }>({ _id: 1 }).limit(50).toArray();
  if (workspaces.length === 0) return 0;
  return await c.slates.countDocuments({ workspaceId: { $in: workspaces.map((w) => w._id) }, isArchived: false }, { limit: stopAt });
}

/**
 * Throws an AppError carrying { code: "board_limit", ... } when the workspace owner's plan has no room
 * for another board. The owner's plan applies (not the creator's), so teammates can fill a Team workspace.
 */
export async function assertBoardCapacity(ownerClerkId: string): Promise<void> {
  const tier = await tierOf(ownerClerkId);
  const limit = limitsFor(tier).maxBoards;
  if (limit === null) return;
  const used = await countOwnedBoards(ownerClerkId, limit);
  if (!checkBoardLimit(tier, used).allowed) throw boardLimitFailure(tier, used);
}

/** The error that tells the UI to show the upgrade prompt. */
export function boardLimitFailure(tier: Tier, used: number): AppError {
  const data = boardLimitError(tier, checkBoardLimit(tier, used));
  return new AppError(data.message, data);
}

/* -------------------------------------------------------------------- reads */

/** Everything the sidebar meter and the pricing modal need about the caller's plan and usage. */
export const getMyBilling = query({
  handler: async (ctx: Ctx) => {
    if (!ctx.userId) return null;
    const now = Date.now();
    const user = await userByClerkId(ctx.userId);
    const tier = effectiveTier(user, now);
    const limits = limitsFor(tier);
    const credits = checkAiCredit(tier, user, now);
    // Only the free plan has a board cap worth counting; paid plans skip the scan.
    const boardsUsed = limits.maxBoards === null ? null : await countOwnedBoards(ctx.userId, limits.maxBoards + 1);
    return {
      tier,
      storedTier: user?.subscriptionTier ?? "free",
      status: user?.subscriptionStatus ?? null,
      interval: user?.billingInterval ?? null,
      seats: user?.subscriptionSeats ?? null,
      periodEnd: user?.razorpayCurrentPeriodEnd ?? null,
      /** A cancelled plan that still has time left. */
      endsAtPeriodEnd: user?.subscriptionStatus === "cancelled" && tier !== "free",
      boards: { used: boardsUsed, limit: limits.maxBoards },
      ai: { used: credits.used, cap: credits.cap, remaining: credits.remaining, resetsAt: credits.resetsAt },
    };
  },
});

/* ---------------------------------------------------------------- AI credits */

export type CreditReservation =
  | { ok: true; tier: Tier; cap: number; used: number; remaining: number; resetsAt: number }
  | { ok: false; tier: Tier; cap: number; used: number; remaining: number; resetsAt: number };

/**
 * Atomically takes AI credits for a user, or reports that none are left. One conditional update on
 * the user document does the whole job (roll the period over if it ended, check the allowance, add
 * the cost), so any number of parallel requests can never spend more than the allowance.
 */
export async function reserveAiCredit(userId: string, cost = 1, source?: ProfileSource): Promise<CreditReservation> {
  const c = await getCollections();
  const spend = Math.max(1, Math.min(10, Math.floor(cost)));
  const now = Date.now();
  const user = await ensureUser(userId, source);
  const tier = effectiveTier(user, now);
  const cap = limitsFor(tier).aiCreditsMonthly;

  const periodOver = { $or: [{ $eq: [{ $type: "$aiCreditsPeriodStart" }, "missing"] }, { $gte: [{ $subtract: [now, "$aiCreditsPeriodStart"] }, CREDIT_PERIOD_MS] }, { $gt: ["$aiCreditsPeriodStart", now] }] };
  const usedNow = { $cond: [periodOver, 0, { $max: [0, { $ifNull: ["$aiCreditsUsedThisPeriod", 0] }] }] };
  const taken = await c.users.findOneAndUpdate(
    { _id: user._id, $expr: { $lte: [{ $add: [usedNow, spend] }, cap] } },
    [{ $set: { aiCreditsUsedThisPeriod: { $add: [usedNow, spend] }, aiCreditsPeriodStart: { $cond: [periodOver, now, "$aiCreditsPeriodStart"] }, aiCreditsMonthlyCap: cap } }],
    { returnDocument: "after" }
  );
  if (taken) {
    const used = taken.aiCreditsUsedThisPeriod ?? spend;
    return { ok: true, tier, cap, used, remaining: Math.max(0, cap - used), resetsAt: (taken.aiCreditsPeriodStart ?? now) + CREDIT_PERIOD_MS };
  }
  // nothing matched: the allowance is used up
  const latest = (await userByClerkId(userId)) ?? user;
  const check = checkAiCredit(tier, latest, now, spend);
  return { ok: false, tier, cap: check.cap, used: check.used, remaining: check.remaining, resetsAt: check.resetsAt };
}

/** Gives credits back when a generation failed after they were reserved. */
export async function refundAiCredit(userId: string, cost = 1): Promise<{ ok: boolean }> {
  const c = await getCollections();
  const refund = Math.max(1, Math.min(10, Math.floor(cost)));
  const res = await c.users.updateOne({ clerkId: userId }, [{ $set: { aiCreditsUsedThisPeriod: { $max: [0, { $subtract: [{ $ifNull: ["$aiCreditsUsedThisPeriod", 0] }, refund] }] } } }]);
  return { ok: res.matchedCount === 1 };
}

/* ------------------------------------------------------------ subscriptions */

export interface SyncSubscriptionInput {
  /** Either the Clerk id (from the order / subscription notes) or the subscription id identifies the user. */
  clerkId?: string;
  tier: Tier;
  status: SubscriptionStatus;
  interval?: BillingInterval;
  seats?: number;
  razorpaySubscriptionId?: string;
  razorpayPlanId?: string;
  razorpayCustomerId?: string;
  razorpayPaymentId?: string;
  currentPeriodEnd?: number;
  /** A new billing cycle starts: refill the AI credits. */
  resetCredits?: boolean;
  eventId?: string;
  eventType?: string;
  /** Used only to create the user row when Clerk hasn't told us about the user yet. */
  profile?: ProfileInput;
}

export type SyncSubscriptionResult =
  | { ok: true; duplicate: true }
  | { ok: true; duplicate: false; clerkId: string; previousSubscriptionId: string | undefined }
  | { ok: false; reason: "user_not_found" };

const BILLING_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Applies a verified Razorpay payment or webhook to a user. Server only: the Next.js routes verify
 * the Razorpay signature first. Idempotent per `eventId`.
 */
export async function syncSubscription(input: SyncSubscriptionInput): Promise<SyncSubscriptionResult> {
  const c = await getCollections();
  const now = Date.now();

  // Claim the delivery id first: a unique index makes a retried delivery (even a concurrent one) a no-op.
  if (input.eventId) {
    try {
      await c.billingEvents.insertOne({ _id: newDocId(), eventId: input.eventId, type: input.eventType ?? "unknown", processedAt: now, expireAt: new Date(now + BILLING_EVENT_TTL_MS) });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return { ok: true, duplicate: true };
      throw e;
    }
  }
  const release = async () => {
    if (input.eventId) await c.billingEvents.deleteOne({ eventId: input.eventId }).catch(() => undefined);
  };

  try {
    let user: UserDoc | null = null;
    if (input.clerkId) user = await userByClerkId(input.clerkId);
    if (!user && input.razorpaySubscriptionId) user = await c.users.findOne({ razorpaySubscriptionId: input.razorpaySubscriptionId });
    if (!user && input.clerkId && input.profile) user = await upsertUser(input.clerkId, input.profile);
    if (!user) {
      await release(); // let Razorpay's retry find the user once Clerk's webhook has landed
      return { ok: false, reason: "user_not_found" };
    }

    // A new subscription replaces the old one; the caller cancels the old one at Razorpay so the user isn't billed twice.
    const previousSubscriptionId =
      input.razorpaySubscriptionId && user.razorpaySubscriptionId && user.razorpaySubscriptionId !== input.razorpaySubscriptionId && user.subscriptionStatus === "active"
        ? user.razorpaySubscriptionId
        : undefined;

    const limits = limitsFor(input.tier);
    const set: Partial<UserDoc> = {
      subscriptionTier: input.tier,
      subscriptionStatus: input.status,
      aiCreditsMonthlyCap: limits.aiCreditsMonthly,
      plan: input.tier,
      updatedAt: now,
    };
    if (input.interval) set.billingInterval = input.interval;
    if (input.seats !== undefined) set.subscriptionSeats = Math.max(1, Math.floor(input.seats));
    if (input.razorpaySubscriptionId) set.razorpaySubscriptionId = input.razorpaySubscriptionId;
    if (input.razorpayPlanId) set.razorpayPlanId = input.razorpayPlanId;
    if (input.razorpayCustomerId) set.razorpayCustomerId = input.razorpayCustomerId;
    if (input.razorpayPaymentId) set.paymentId = input.razorpayPaymentId;
    if (input.currentPeriodEnd !== undefined) set.razorpayCurrentPeriodEnd = input.currentPeriodEnd;
    if (input.resetCredits) {
      set.aiCreditsUsedThisPeriod = 0;
      set.aiCreditsPeriodStart = now;
    }
    await c.users.updateOne({ _id: user._id }, { $set: set });
    return { ok: true, duplicate: false, clerkId: user.clerkId, previousSubscriptionId };
  } catch (e) {
    await release(); // the delivery was not applied, so a retry must be allowed to
    throw e;
  }
}

