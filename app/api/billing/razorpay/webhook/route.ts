import { createHash } from "node:crypto";
import { BillingConfigError, parseNotes, periodMs, syncToConvex, tierForPlanId } from "@/lib/billing/razorpay";
import { verifyWebhookSignature } from "@/lib/billing/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SubscriptionEntity {
  id: string;
  plan_id?: string;
  status?: string;
  customer_id?: string | null;
  quantity?: number;
  current_end?: number | null;
  ended_at?: number | null;
  notes?: unknown;
}

interface WebhookBody {
  event?: string;
  payload?: {
    subscription?: { entity?: SubscriptionEntity };
    payment?: { entity?: { id?: string } };
  };
}

const ok = (message = "ok") => new Response(message, { status: 200 });

/**
 * POST /api/billing/razorpay/webhook
 * Razorpay's source of truth for renewals and cancellations. The raw body is verified against the
 * `X-Razorpay-Signature` header with the webhook secret before anything is parsed. Events we don't
 * act on are acknowledged (200) so Razorpay doesn't keep retrying them; a transient failure returns
 * 5xx so it does.
 *
 *   subscription.activated  -> plan active, credits refilled
 *   subscription.charged    -> renewal paid: period extended, credits refilled
 *   subscription.cancelled  -> access continues until the paid period ends
 *   subscription.halted     -> payment retries exhausted: access stops
 *   subscription.completed  -> ran its full term: treated as cancelled
 */
export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[billing/webhook] RAZORPAY_WEBHOOK_SECRET is not set");
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), secret)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = body.event ?? "";
  const sub = body.payload?.subscription?.entity;
  if (!event.startsWith("subscription.") || !sub?.id) return ok("ignored");

  // Razorpay sends a unique id per delivery; fall back to a content hash so retries still dedupe.
  const eventId = req.headers.get("x-razorpay-event-id") || `hash:${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
  const notes = parseNotes(sub.notes);
  const fromPlan = tierForPlanId(sub.plan_id);
  const tier = notes.tier ?? fromPlan?.tier;
  const interval = notes.interval ?? fromPlan?.interval;
  const periodEnd = sub.current_end ? sub.current_end * 1000 : sub.ended_at ? sub.ended_at * 1000 : undefined;

  const common = {
    clerkId: notes.clerkId,
    razorpaySubscriptionId: sub.id,
    razorpayPlanId: sub.plan_id,
    razorpayCustomerId: sub.customer_id ?? undefined,
    seats: notes.seats ?? sub.quantity,
    interval,
    eventId,
    eventType: event,
  };

  try {
    let result;
    switch (event) {
      case "subscription.activated":
      case "subscription.charged": {
        if (!tier) return ok("unknown plan");
        result = await syncToConvex({
          ...common,
          tier,
          status: "active",
          razorpayPaymentId: body.payload?.payment?.entity?.id,
          currentPeriodEnd: periodEnd ?? (interval ? Date.now() + periodMs(interval) : undefined),
          resetCredits: true,
        });
        break;
      }
      case "subscription.cancelled":
      case "subscription.completed": {
        if (!tier) return ok("unknown plan");
        result = await syncToConvex({ ...common, tier, status: "cancelled", currentPeriodEnd: periodEnd });
        break;
      }
      case "subscription.halted": {
        if (!tier) return ok("unknown plan");
        result = await syncToConvex({ ...common, tier, status: "halted", currentPeriodEnd: periodEnd });
        break;
      }
      default:
        return ok("ignored");
    }
    // The user row may not exist yet if Clerk's webhook is slow: ask Razorpay to retry later.
    if (!result.ok) return new Response("User not found yet", { status: 503 });
    return ok();
  } catch (e) {
    if (e instanceof BillingConfigError) {
      console.error("[billing/webhook]", e.message);
      return new Response(e.message, { status: 503 });
    }
    console.error("[billing/webhook]", e);
    return new Response("Could not apply the event", { status: 500 });
  }
}
