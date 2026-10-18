import { auth, currentUser } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { priceFor } from "@/lib/billing/plans";
import { BillingConfigError, getRazorpay, planIdFor, razorpayKeys } from "@/lib/billing/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tier: z.enum(["pro", "team"]),
  interval: z.enum(["monthly", "annual"]),
  seats: z.number().int().min(1).max(500).optional(),
});

function json(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Razorpay's SDK rejects with `{ statusCode, error: { description } }` rather than an Error. */
function describe(err: unknown): string {
  const e = err as { error?: { description?: string }; message?: string } | null;
  return e?.error?.description || e?.message || "Razorpay rejected the request.";
}

/**
 * POST /api/billing/razorpay/create-subscription
 * Starts a checkout for the signed-in user. With a Razorpay plan configured for the chosen tier and
 * interval it creates a recurring subscription; without one it creates a one-time order for the first
 * period, so billing can be tested before plans exist in the dashboard. The server decides the price:
 * the client only says which plan it wants.
 */
export async function POST(req: Request) {
  const { userId, getToken } = await auth();
  if (!userId) return json(401, "unauthenticated", "Sign in to upgrade your plan.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return json(400, "bad_request", e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid request" : "Invalid request body");
  }

  let keys: ReturnType<typeof razorpayKeys>;
  try {
    keys = razorpayKeys();
  } catch (e) {
    return json(503, "not_configured", e instanceof BillingConfigError ? e.message : "Payments aren't configured.");
  }

  // A checkout creates objects at Razorpay, so cap how fast one account can open them.
  try {
    const token = await getToken({ template: "convex" });
    if (token) {
      const limit = await fetchMutation(api.usage.consume, { bucket: "billing-create", limit: 12, windowMs: 3_600_000 }, { token });
      if (!limit.allowed) return json(429, "rate_limited", "Too many checkout attempts. Try again in a little while.");
    }
  } catch {
    /* the limiter is best-effort; Razorpay applies its own limits */
  }

  const seats = body.tier === "team" ? body.seats ?? 1 : 1;
  const notes = { clerkId: userId, tier: body.tier, interval: body.interval, seats: String(seats) };
  const amount = priceFor(body.tier, body.interval, seats);
  const user = await currentUser();
  const prefill = {
    name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
    email: user?.primaryEmailAddress?.emailAddress,
  };

  try {
    const rz = getRazorpay();
    const planId = planIdFor(body.tier, body.interval);
    if (planId) {
      const sub = await rz.subscriptions.create({
        plan_id: planId,
        total_count: body.interval === "annual" ? 10 : 120,
        quantity: seats,
        customer_notify: 1,
        notes,
      });
      return Response.json({ mode: "subscription", keyId: keys.keyId, subscriptionId: sub.id, tier: body.tier, interval: body.interval, seats, amount, currency: "INR", prefill }, { headers: { "Cache-Control": "no-store" } });
    }
    const order = await rz.orders.create({
      amount,
      currency: "INR",
      receipt: `slate_${Date.now().toString(36)}_${userId.slice(-8)}`.slice(0, 40),
      notes,
    });
    return Response.json({ mode: "order", keyId: keys.keyId, orderId: order.id, tier: body.tier, interval: body.interval, seats, amount, currency: "INR", prefill }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[billing/create-subscription]", e);
    return json(502, "razorpay_error", describe(e));
  }
}
