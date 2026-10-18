import { describe, expect, it } from "vitest";
import {
  CREDIT_PERIOD_MS,
  RENEWAL_GRACE_MS,
  checkAiCredit,
  checkBoardLimit,
  creditsError,
  effectiveTier,
  boardLimitError,
  isBillingErrorData,
  normalizeCredits,
} from "@/lib/billing/limits";
import { PLANS, annualSavingsPct, formatInr, hasFeature, priceFor } from "@/lib/billing/plans";
import { checkoutSignedPayload, signCheckout, signWebhook, verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/billing/signature";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("pricing", () => {
  it("matches the published price list", () => {
    expect(formatInr(PLANS.free.monthly)).toBe("₹0");
    expect(formatInr(PLANS.pro.monthly)).toBe("₹999");
    expect(formatInr(PLANS.pro.annual)).toBe("₹8,999");
    expect(formatInr(PLANS.team.monthly)).toBe("₹1,999");
  });

  it("charges per seat only on the team plan", () => {
    expect(priceFor("pro", "monthly", 5)).toBe(99_900);
    expect(priceFor("team", "monthly", 3)).toBe(3 * 199_900);
    expect(priceFor("team", "annual", 0)).toBe(1_799_900);
    expect(priceFor("pro", "annual")).toBe(899_900);
  });

  it("reports a real annual saving", () => {
    expect(annualSavingsPct("pro")).toBe(25);
    expect(annualSavingsPct("team")).toBeGreaterThan(20);
  });

  it("gates finops itemization to paid plans", () => {
    expect(hasFeature("free", "finopsItemization")).toBe(false);
    expect(hasFeature("pro", "finopsItemization")).toBe(true);
    expect(hasFeature("team", "finopsCsv")).toBe(true);
    expect(hasFeature("pro", "teamCollaboration")).toBe(false);
  });
});

describe("effectiveTier", () => {
  it("defaults to free", () => {
    expect(effectiveTier(null, NOW)).toBe("free");
    expect(effectiveTier({}, NOW)).toBe("free");
    expect(effectiveTier({ subscriptionTier: "free", subscriptionStatus: "active" }, NOW)).toBe("free");
  });

  it("grants the paid tier only while the subscription is active", () => {
    expect(effectiveTier({ subscriptionTier: "pro", subscriptionStatus: "active", razorpayCurrentPeriodEnd: NOW + DAY }, NOW)).toBe("pro");
    expect(effectiveTier({ subscriptionTier: "team", subscriptionStatus: "active" }, NOW)).toBe("team");
    expect(effectiveTier({ subscriptionTier: "pro", subscriptionStatus: "pending" }, NOW)).toBe("free");
    expect(effectiveTier({ subscriptionTier: "pro", subscriptionStatus: "halted", razorpayCurrentPeriodEnd: NOW + DAY }, NOW)).toBe("free");
    expect(effectiveTier({ subscriptionTier: "pro" }, NOW)).toBe("free");
  });

  it("keeps a cancelled plan until the paid period ends", () => {
    const cancelled = { subscriptionTier: "pro" as const, subscriptionStatus: "cancelled" as const };
    expect(effectiveTier({ ...cancelled, razorpayCurrentPeriodEnd: NOW + DAY }, NOW)).toBe("pro");
    expect(effectiveTier({ ...cancelled, razorpayCurrentPeriodEnd: NOW - 1 }, NOW)).toBe("free");
    expect(effectiveTier(cancelled, NOW)).toBe("free");
  });

  it("lapses an active plan whose renewal never arrived, after the grace period", () => {
    const base = { subscriptionTier: "pro" as const, subscriptionStatus: "active" as const };
    expect(effectiveTier({ ...base, razorpayCurrentPeriodEnd: NOW - RENEWAL_GRACE_MS + 1000 }, NOW)).toBe("pro");
    expect(effectiveTier({ ...base, razorpayCurrentPeriodEnd: NOW - RENEWAL_GRACE_MS - 1000 }, NOW)).toBe("free");
  });
});

describe("board cap", () => {
  it("free allows three boards, paid plans are unlimited", () => {
    expect(checkBoardLimit("free", 0)).toMatchObject({ allowed: true, limit: 3, remaining: 3 });
    expect(checkBoardLimit("free", 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkBoardLimit("free", 3)).toMatchObject({ allowed: false, remaining: 0 });
    expect(checkBoardLimit("pro", 10_000)).toMatchObject({ allowed: true, limit: null, remaining: null });
    expect(checkBoardLimit("team", 10_000).allowed).toBe(true);
  });

  it("produces a machine readable error", () => {
    const data = boardLimitError("free", checkBoardLimit("free", 3));
    expect(isBillingErrorData(data)).toBe(true);
    expect(data.code).toBe("board_limit");
    expect(data.message).toMatch(/3 boards/);
  });
});

describe("AI credits", () => {
  it("starts a fresh period at zero", () => {
    expect(normalizeCredits(undefined, NOW)).toEqual({ used: 0, periodStart: NOW });
    expect(normalizeCredits({ aiCreditsUsedThisPeriod: 5, aiCreditsPeriodStart: NOW - 2 * DAY }, NOW)).toEqual({ used: 5, periodStart: NOW - 2 * DAY });
  });

  it("refills after thirty days", () => {
    const stale = { aiCreditsUsedThisPeriod: 15, aiCreditsPeriodStart: NOW - CREDIT_PERIOD_MS };
    expect(normalizeCredits(stale, NOW)).toEqual({ used: 0, periodStart: NOW });
    expect(checkAiCredit("free", stale, NOW).allowed).toBe(true);
  });

  it("enforces the monthly cap per tier", () => {
    const fields = (used: number) => ({ aiCreditsUsedThisPeriod: used, aiCreditsPeriodStart: NOW - DAY });
    expect(checkAiCredit("free", fields(14), NOW)).toMatchObject({ allowed: true, cap: 15, remaining: 1 });
    expect(checkAiCredit("free", fields(15), NOW)).toMatchObject({ allowed: false, remaining: 0 });
    expect(checkAiCredit("pro", fields(299), NOW).allowed).toBe(true);
    expect(checkAiCredit("pro", fields(300), NOW).allowed).toBe(false);
    expect(checkAiCredit("free", fields(14), NOW, 2).allowed).toBe(false);
  });

  it("tells the user when credits come back", () => {
    const check = checkAiCredit("free", { aiCreditsUsedThisPeriod: 15, aiCreditsPeriodStart: NOW - DAY }, NOW);
    expect(check.resetsAt).toBe(NOW - DAY + CREDIT_PERIOD_MS);
    expect(creditsError("free", check).code).toBe("credits_exhausted");
  });
});

describe("razorpay signatures", () => {
  const secret = "rzp_test_secret_value";

  it("uses the documented field order for orders and subscriptions", () => {
    expect(checkoutSignedPayload({ kind: "order", orderId: "order_1", paymentId: "pay_1" })).toBe("order_1|pay_1");
    expect(checkoutSignedPayload({ kind: "subscription", subscriptionId: "sub_1", paymentId: "pay_1" })).toBe("pay_1|sub_1");
  });

  it("accepts a correct checkout signature and rejects tampering", () => {
    const order = { kind: "order" as const, orderId: "order_ABC", paymentId: "pay_XYZ" };
    const sig = signCheckout(order, secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCheckoutSignature(order, sig, secret)).toBe(true);
    expect(verifyCheckoutSignature({ ...order, paymentId: "pay_OTHER" }, sig, secret)).toBe(false);
    expect(verifyCheckoutSignature(order, sig, "another-secret")).toBe(false);
    expect(verifyCheckoutSignature(order, sig.slice(0, 20), secret)).toBe(false);
    expect(verifyCheckoutSignature(order, "", secret)).toBe(false);
    expect(verifyCheckoutSignature({ kind: "subscription", subscriptionId: "order_ABC", paymentId: "pay_XYZ" }, sig, secret)).toBe(false);
  });

  it("verifies webhook bodies byte for byte", () => {
    const body = JSON.stringify({ event: "subscription.charged", payload: {} });
    const sig = signWebhook(body, "whsec_test");
    expect(verifyWebhookSignature(body, sig, "whsec_test")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "whsec_test")).toBe(false);
    expect(verifyWebhookSignature(body, null, "whsec_test")).toBe(false);
    expect(verifyWebhookSignature(body, sig, "")).toBe(false);
  });
});
