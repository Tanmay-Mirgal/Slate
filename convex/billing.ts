import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { boardLimitError, checkAiCredit, checkBoardLimit, CREDIT_PERIOD_MS, effectiveTier, limitsFor, normalizeCredits } from "../lib/billing/limits";
import type { Tier } from "../lib/billing/plans";
import { intervalValidator, subscriptionStatusValidator, tierValidator } from "./schema";

/* ------------------------------------------------------------------ helpers */

/** Constant-time string comparison, so the shared secret can't be recovered by timing. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Mutations that grant plans or refund credits are public functions (the Next.js server calls them),
 * so each requires a secret that only the server and the Convex deployment know.
 */
function requireServerSecret(provided: string) {
  const expected = process.env.BILLING_SYNC_SECRET;
  if (!expected || expected.length < 16) throw new Error("BILLING_SYNC_SECRET is not configured in the Convex environment");
  if (!safeEqual(expected, provided)) throw new Error("Invalid billing secret");
}

export async function userByClerkId(ctx: QueryCtx, clerkId: string): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
}

/** The tier a clerk user can use right now (free when we have no row for them). */
export async function tierOf(ctx: QueryCtx, clerkId: string, now = Date.now()): Promise<Tier> {
  return effectiveTier(await userByClerkId(ctx, clerkId), now);
}

/** Active boards in the workspaces `ownerClerkId` owns. Stops counting at `stopAt`, which is all a cap check needs. */
export async function countOwnedBoards(ctx: QueryCtx, ownerClerkId: string, stopAt = 5000): Promise<number> {
  const workspaces = await ctx.db
    .query("workspaces")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerClerkId))
    .take(50);
  let total = 0;
  for (const w of workspaces) {
    if (total >= stopAt) break;
    const rows = await ctx.db
      .query("slates")
      .withIndex("by_workspace_active", (q) => q.eq("workspaceId", w._id).eq("isArchived", false))
      .take(stopAt - total);
    total += rows.length;
  }
  return total;
}

/**
 * Throws a ConvexError({ code: "board_limit", ... }) when the workspace owner's plan has no room for
 * another board. The owner's plan applies (not the creator's), so teammates can fill a Team workspace.
 */
export async function assertBoardCapacity(ctx: QueryCtx, ownerClerkId: string): Promise<void> {
  const tier = await tierOf(ctx, ownerClerkId);
  const limit = limitsFor(tier).maxBoards;
  if (limit === null) return;
  const used = await countOwnedBoards(ctx, ownerClerkId, limit);
  const check = checkBoardLimit(tier, used);
  if (!check.allowed) throw new ConvexError(boardLimitError(tier, check));
}

async function ensureUser(ctx: MutationCtx, identity: { subject: string; email?: string; givenName?: string; familyName?: string; pictureUrl?: string }): Promise<Doc<"users">> {
  const existing = await userByClerkId(ctx, identity.subject);
  if (existing) return existing;
  const id = await ctx.db.insert("users", {
    clerkId: identity.subject,
    email: identity.email ?? "",
    firstName: identity.givenName ?? null,
    lastName: identity.familyName ?? null,
    imageUrl: identity.pictureUrl ?? null,
  });
  return (await ctx.db.get(id))!;
}

/* -------------------------------------------------------------------- reads */

/** Everything the sidebar meter and the pricing modal need about the caller's plan and usage. */
export const getMyBilling = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const now = Date.now();
    const user = await userByClerkId(ctx, identity.subject);
    const tier = effectiveTier(user, now);
    const limits = limitsFor(tier);
    const credits = checkAiCredit(tier, user, now);
    // Only the free plan has a board cap worth counting; paid plans skip the scan.
    const boardsUsed = limits.maxBoards === null ? null : await countOwnedBoards(ctx, identity.subject, limits.maxBoards + 1);
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

/**
 * Atomically takes AI credits for the caller, or reports that none are left. Runs under the caller's
 * own identity (a user can only spend their own credits). Refunds need the server secret.
 */
export const reserveAiCredit = mutation({
  args: { cost: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const cost = Math.max(1, Math.min(10, Math.floor(args.cost ?? 1)));
    const now = Date.now();
    const user = await ensureUser(ctx, identity);
    const tier = effectiveTier(user, now);
    const check = checkAiCredit(tier, user, now, cost);
    if (!check.allowed) {
      return { ok: false as const, tier, cap: check.cap, used: check.used, remaining: check.remaining, resetsAt: check.resetsAt };
    }
    const state = normalizeCredits(user, now);
    const used = state.used + cost;
    await ctx.db.patch(user._id, { aiCreditsUsedThisPeriod: used, aiCreditsPeriodStart: state.periodStart, aiCreditsMonthlyCap: check.cap });
    return { ok: true as const, tier, cap: check.cap, used, remaining: Math.max(0, check.cap - used), resetsAt: state.periodStart + CREDIT_PERIOD_MS };
  },
});

/** Gives credits back when a generation failed after they were reserved. Server only. */
export const refundAiCredit = mutation({
  args: { secret: v.string(), clerkId: v.string(), cost: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const user = await userByClerkId(ctx, args.clerkId);
    if (!user) return { ok: false as const };
    const cost = Math.max(1, Math.min(10, Math.floor(args.cost ?? 1)));
    await ctx.db.patch(user._id, { aiCreditsUsedThisPeriod: Math.max(0, (user.aiCreditsUsedThisPeriod ?? 0) - cost) });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------ subscriptions */

/**
 * Applies a verified Razorpay payment or webhook to a user. Server only: the Next.js routes verify
 * the Razorpay signature, then call this with the shared secret. Idempotent per `eventId`.
 */
export const syncSubscription = mutation({
  args: {
    secret: v.string(),
    /** Either the Clerk id (from the order / subscription notes) or the subscription id identifies the user. */
    clerkId: v.optional(v.string()),
    tier: tierValidator,
    status: subscriptionStatusValidator,
    interval: v.optional(intervalValidator),
    seats: v.optional(v.number()),
    razorpaySubscriptionId: v.optional(v.string()),
    razorpayPlanId: v.optional(v.string()),
    razorpayCustomerId: v.optional(v.string()),
    razorpayPaymentId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    /** A new billing cycle starts: refill the AI credits. */
    resetCredits: v.optional(v.boolean()),
    eventId: v.optional(v.string()),
    eventType: v.optional(v.string()),
    /** Used only to create the user row when the Clerk webhook hasn't delivered it yet. */
    profile: v.optional(v.object({ email: v.string(), firstName: v.union(v.string(), v.null()), lastName: v.union(v.string(), v.null()), imageUrl: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.secret);
    const now = Date.now();

    if (args.eventId) {
      const seen = await ctx.db
        .query("billingEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId!))
        .first();
      if (seen) return { ok: true as const, duplicate: true as const };
    }

    let user: Doc<"users"> | null = null;
    if (args.clerkId) user = await userByClerkId(ctx, args.clerkId);
    if (!user && args.razorpaySubscriptionId) {
      user = await ctx.db
        .query("users")
        .withIndex("by_razorpaySubscriptionId", (q) => q.eq("razorpaySubscriptionId", args.razorpaySubscriptionId))
        .first();
    }
    if (!user && args.clerkId && args.profile) {
      const id = await ctx.db.insert("users", { clerkId: args.clerkId, ...args.profile });
      user = await ctx.db.get(id);
    }
    if (!user) return { ok: false as const, reason: "user_not_found" as const };

    // A new subscription replaces the old one; the caller cancels the old one at Razorpay so the user isn't billed twice.
    const previousSubscriptionId =
      args.razorpaySubscriptionId && user.razorpaySubscriptionId && user.razorpaySubscriptionId !== args.razorpaySubscriptionId && user.subscriptionStatus === "active"
        ? user.razorpaySubscriptionId
        : undefined;

    const limits = limitsFor(args.tier);
    const patch: Partial<Doc<"users">> = {
      subscriptionTier: args.tier,
      subscriptionStatus: args.status,
      aiCreditsMonthlyCap: limits.aiCreditsMonthly,
      plan: args.tier,
    };
    if (args.interval) patch.billingInterval = args.interval;
    if (args.seats !== undefined) patch.subscriptionSeats = Math.max(1, Math.floor(args.seats));
    if (args.razorpaySubscriptionId) patch.razorpaySubscriptionId = args.razorpaySubscriptionId;
    if (args.razorpayPlanId) patch.razorpayPlanId = args.razorpayPlanId;
    if (args.razorpayCustomerId) patch.razorpayCustomerId = args.razorpayCustomerId;
    if (args.razorpayPaymentId) patch.paymentId = args.razorpayPaymentId;
    if (args.currentPeriodEnd !== undefined) patch.razorpayCurrentPeriodEnd = args.currentPeriodEnd;
    if (args.resetCredits) {
      patch.aiCreditsUsedThisPeriod = 0;
      patch.aiCreditsPeriodStart = now;
    }
    await ctx.db.patch(user._id, patch);

    if (args.eventId) await ctx.db.insert("billingEvents", { eventId: args.eventId, type: args.eventType ?? "unknown", processedAt: now });
    return { ok: true as const, duplicate: false as const, clerkId: user.clerkId, previousSubscriptionId };
  },
});
