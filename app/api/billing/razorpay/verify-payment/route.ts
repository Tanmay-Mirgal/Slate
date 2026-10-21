import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { priceFor, type Interval, type PaidTier } from "@/lib/billing/plans";
import { BillingConfigError, getRazorpay, parseNotes, periodMs, planIdFor, razorpayKeys, syncToDatabase, tierForPlanId } from "@/lib/billing/razorpay";
import { verifyCheckoutSignature } from "@/lib/billing/signature";
import { profileFromClerk } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    razorpay_payment_id: z.string().min(5).max(64),
    razorpay_signature: z.string().min(16).max(256),
    razorpay_order_id: z.string().min(5).max(64).optional(),
    razorpay_subscription_id: z.string().min(5).max(64).optional(),
  })
  .refine((b) => !!b.razorpay_order_id !== !!b.razorpay_subscription_id, { message: "Send exactly one of razorpay_order_id or razorpay_subscription_id" });

function json(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function describe(err: unknown): string {
  const e = err as { error?: { description?: string }; message?: string } | null;
  return e?.error?.description || e?.message || "Razorpay rejected the request.";
}

/**
 * POST /api/billing/razorpay/verify-payment
 * Called by the browser right after Razorpay Checkout succeeds. Nothing the browser says is trusted:
 * the HMAC-SHA256 signature proves Razorpay produced the callback, then the order / subscription is
 * fetched from Razorpay itself to confirm it belongs to this user, was paid, and which plan it was.
 * Only then is the plan written to the database. The webhook later confirms the same state.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return json(401, "unauthenticated", "Sign in to continue.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return json(400, "bad_request", e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid request" : "Invalid request body");
  }

  let keySecret: string;
  try {
    keySecret = razorpayKeys().keySecret;
  } catch (e) {
    return json(503, "not_configured", e instanceof BillingConfigError ? e.message : "Payments aren't configured.");
  }

  const paymentId = body.razorpay_payment_id;
  const valid = body.razorpay_order_id
    ? verifyCheckoutSignature({ kind: "order", orderId: body.razorpay_order_id, paymentId }, body.razorpay_signature, keySecret)
    : verifyCheckoutSignature({ kind: "subscription", subscriptionId: body.razorpay_subscription_id!, paymentId }, body.razorpay_signature, keySecret);
  if (!valid) return json(400, "invalid_signature", "The payment signature didn't match, so the plan was not changed.");

  try {
    const rz = getRazorpay();
    const user = await currentUser();
    const profile = user ? profileFromClerk(user) : undefined;

    if (body.razorpay_order_id) {
      const order = await rz.orders.fetch(body.razorpay_order_id);
      const notes = parseNotes(order.notes);
      if (notes.clerkId !== userId) return json(403, "forbidden", "That payment belongs to a different account.");
      if (!notes.tier || !notes.interval) return json(400, "bad_order", "This order isn't a Slate plan.");
      const expected = priceFor(notes.tier, notes.interval, notes.seats ?? 1);

      let payment = await rz.payments.fetch(paymentId);
      if (payment.order_id !== order.id) return json(400, "mismatch", "That payment doesn't belong to this order.");
      if (payment.status === "authorized") payment = await rz.payments.capture(paymentId, Number(order.amount), order.currency);
      if (payment.status !== "captured") return json(402, "not_paid", "The payment hasn't been completed.");
      if (Number(payment.amount) < expected) return json(402, "underpaid", "The amount paid doesn't cover this plan.");

      const result = await syncToDatabase({
        clerkId: userId,
        tier: notes.tier,
        status: "active",
        interval: notes.interval,
        seats: notes.seats,
        razorpayPaymentId: paymentId,
        currentPeriodEnd: Date.now() + periodMs(notes.interval),
        resetCredits: true,
        eventId: `checkout:${paymentId}`,
        eventType: "checkout.order_verified",
        profile,
      });
      if (!result.ok) return json(409, "user_not_found", "We couldn't find your account yet. Try again in a moment.");
      return Response.json({ ok: true, tier: notes.tier, interval: notes.interval }, { headers: { "Cache-Control": "no-store" } });
    }

    const sub = await rz.subscriptions.fetch(body.razorpay_subscription_id!);
    const notes = parseNotes(sub.notes);
    if (notes.clerkId !== userId) return json(403, "forbidden", "That subscription belongs to a different account.");
    const fromPlan = tierForPlanId(sub.plan_id);
    const tier: PaidTier | undefined = notes.tier ?? fromPlan?.tier;
    const interval: Interval | undefined = notes.interval ?? fromPlan?.interval;
    if (!tier || !interval) return json(400, "bad_subscription", "This subscription isn't a Slate plan.");
    // The plan on the subscription must be the one configured for the tier in the notes.
    if (planIdFor(tier, interval) !== sub.plan_id) return json(400, "mismatch", "The subscription's plan doesn't match the requested tier.");
    if (sub.status !== "authenticated" && sub.status !== "active") return json(402, "not_active", "The subscription hasn't been activated yet.");

    const result = await syncToDatabase({
      clerkId: userId,
      tier,
      status: "active",
      interval,
      seats: notes.seats ?? Number(sub.quantity ?? 1),
      razorpaySubscriptionId: sub.id,
      razorpayPlanId: sub.plan_id,
      razorpayCustomerId: (sub as { customer_id?: string | null }).customer_id ?? undefined,
      razorpayPaymentId: paymentId,
      currentPeriodEnd: sub.current_end ? sub.current_end * 1000 : Date.now() + periodMs(interval),
      resetCredits: true,
      eventId: `checkout:${paymentId}`,
      eventType: "checkout.subscription_verified",
      profile,
    });
    if (!result.ok) return json(409, "user_not_found", "We couldn't find your account yet. Try again in a moment.");
    // Switching plans: stop the old subscription so the customer isn't charged for both.
    if (result.duplicate === false && result.previousSubscriptionId) {
      try {
        await rz.subscriptions.cancel(result.previousSubscriptionId, false);
      } catch (e) {
        console.error("[billing/verify-payment] could not cancel the replaced subscription", result.previousSubscriptionId, e);
      }
    }
    return Response.json({ ok: true, tier, interval }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[billing/verify-payment]", e);
    return json(502, "razorpay_error", describe(e));
  }
}
