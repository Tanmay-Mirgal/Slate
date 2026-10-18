"use client";

import type { Interval, PaidTier } from "./plans";

/** Browser side of the Razorpay flow: load Standard Checkout, open it, and have the server verify the result. */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_signature: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
}

interface RazorpayOptions {
  key: string;
  name: string;
  description: string;
  image?: string;
  order_id?: string;
  subscription_id?: string;
  prefill?: { name?: string; email?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: CheckoutSuccess) => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (response: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export class CheckoutError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

let loading: Promise<void> | null = null;

/** Injects checkout.js once; resolves when `window.Razorpay` exists. */
export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new CheckoutError("ssr", "Checkout is only available in the browser."));
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve() : reject(new CheckoutError("load", "Razorpay Checkout didn't initialise.")));
    script.onerror = () => {
      script.remove();
      reject(new CheckoutError("load", "Couldn't load Razorpay Checkout. Check your connection or ad blocker and try again."));
    };
    document.head.appendChild(script);
  }).catch((e) => {
    loading = null; // allow a retry after a failed load
    throw e;
  });
  return loading;
}

interface SessionResponse {
  mode: "subscription" | "order";
  keyId: string;
  subscriptionId?: string;
  orderId?: string;
  tier: PaidTier;
  interval: Interval;
  seats: number;
  prefill?: { name?: string; email?: string };
}

async function readError(res: Response, fallback: string): Promise<CheckoutError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new CheckoutError(body.error?.code ?? "request_failed", body.error?.message ?? fallback);
  } catch {
    return new CheckoutError("request_failed", fallback);
  }
}

export interface CheckoutRequest {
  tier: PaidTier;
  interval: Interval;
  seats?: number;
}

/**
 * Creates the order / subscription on the server, opens Razorpay Checkout, then asks the server to
 * verify the signed result. Resolves once the plan is active; rejects with a CheckoutError when the
 * user closes the window, the payment fails, or verification fails. Closing the window is code "dismissed".
 */
export async function startCheckout(req: CheckoutRequest): Promise<{ tier: PaidTier; interval: Interval }> {
  const [, res] = await Promise.all([loadRazorpay(), fetch("/api/billing/razorpay/create-subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) })]);
  if (!res.ok) throw await readError(res, "Couldn't start the checkout.");
  const session = (await res.json()) as SessionResponse;
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new CheckoutError("load", "Razorpay Checkout isn't available.");

  return await new Promise((resolve, reject) => {
    let settled = false;
    let verifying = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const rz = new Razorpay({
      key: session.keyId,
      name: "Slate",
      description: `${session.tier === "team" ? "Team" : "Pro"} plan · ${session.interval === "annual" ? "billed yearly" : "billed monthly"}${session.tier === "team" && session.seats > 1 ? ` · ${session.seats} seats` : ""}`,
      image: `${window.location.origin}/logo.png`,
      ...(session.mode === "subscription" ? { subscription_id: session.subscriptionId } : { order_id: session.orderId }),
      prefill: session.prefill,
      theme: { color: "#6366f1" },
      handler: (response) => {
        verifying = true; // the modal closes right after this; that is not the user abandoning the payment
        void (async () => {
          try {
            const verified = await fetch("/api/billing/razorpay/verify-payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(response) });
            if (!verified.ok) throw await readError(verified, "We couldn't confirm the payment.");
            finish(() => resolve({ tier: session.tier, interval: session.interval }));
          } catch (e) {
            finish(() => reject(e instanceof CheckoutError ? e : new CheckoutError("verify_failed", "We couldn't confirm the payment. If you were charged, your plan will activate shortly.")));
          }
        })();
      },
      modal: { ondismiss: () => !verifying && finish(() => reject(new CheckoutError("dismissed", "Checkout closed."))) },
    });
    rz.on("payment.failed", (r) => finish(() => reject(new CheckoutError("payment_failed", r.error?.description ?? "The payment failed. Try another method."))));
    rz.open();
  });
}
