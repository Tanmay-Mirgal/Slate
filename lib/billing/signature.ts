import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signs two different things with HMAC-SHA256 and hex-encodes the digest:
 *   - the checkout callback (proves the browser really completed a payment), keyed with the API secret
 *   - webhook deliveries (proves a request really came from Razorpay), keyed with the webhook secret
 * Both comparisons are constant-time.
 */

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function equalHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual.trim().toLowerCase(), "utf8");
  // timingSafeEqual throws on length mismatch, which would leak the length; reject first.
  return a.length === b.length && timingSafeEqual(a, b);
}

export type CheckoutPayload =
  | { kind: "order"; orderId: string; paymentId: string }
  | { kind: "subscription"; subscriptionId: string; paymentId: string };

/** The exact string Razorpay signs for a checkout callback (the two kinds order their fields differently). */
export function checkoutSignedPayload(p: CheckoutPayload): string {
  return p.kind === "order" ? `${p.orderId}|${p.paymentId}` : `${p.paymentId}|${p.subscriptionId}`;
}

export function signCheckout(p: CheckoutPayload, keySecret: string): string {
  return hmacHex(keySecret, checkoutSignedPayload(p));
}

export function verifyCheckoutSignature(p: CheckoutPayload, signature: string, keySecret: string): boolean {
  if (!signature || !keySecret) return false;
  return equalHex(signCheckout(p, keySecret), signature);
}

/** Webhook signature: HMAC of the raw request body. Pass the body exactly as received, before any JSON parsing. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  return equalHex(hmacHex(webhookSecret, rawBody), signature);
}

export function signWebhook(rawBody: string, webhookSecret: string): string {
  return hmacHex(webhookSecret, rawBody);
}
