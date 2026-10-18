"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { AlertTriangle, Check, Loader2, Minus, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckoutError, startCheckout } from "@/lib/billing/checkout-client";
import type { BillingErrorCode } from "@/lib/billing/limits";
import { PLANS, annualSavingsPct, formatInr, priceFor, tierAtLeast, type Interval, type PaidTier, type Tier } from "@/lib/billing/plans";

interface PricingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the modal opened, so it can explain the wall the user just hit. */
  reason?: BillingErrorCode | null;
  /** Called after a verified upgrade. */
  onUpgraded?: (tier: PaidTier) => void;
}

/** The slice of the billing query the modal needs. */
export interface PricingBilling {
  tier: Tier;
  endsAtPeriodEnd?: boolean;
  periodEnd?: number | null;
}

interface PricingModalViewProps extends PricingModalProps {
  billing: PricingBilling | null | undefined;
  isSignedIn: boolean;
  isLoaded: boolean;
}

const REASONS: Record<BillingErrorCode, string> = {
  board_limit: "You've reached the 3-board limit on the Free plan. Upgrade for unlimited boards.",
  credits_exhausted: "You've used this month's AI diagram credits. Upgrade for more, or wait for them to refill.",
};

const MAX_SEATS = 50;

function priceLine(tier: PaidTier, interval: Interval, seats: number) {
  const plan = PLANS[tier];
  const unit = interval === "annual" ? plan.annual : plan.monthly;
  const perSeat = plan.perSeat ? " / seat" : "";
  return {
    headline: formatInr(unit),
    suffix: `${perSeat} / ${interval === "annual" ? "year" : "month"}`.trim(),
    detail:
      interval === "annual"
        ? `${formatInr(Math.round(unit / 12))} a month, billed yearly`
        : plan.perSeat && seats > 1
          ? `${seats} seats · ${formatInr(priceFor(tier, interval, seats))} a month`
          : "Billed monthly, cancel anytime",
  };
}

/** Connected pricing modal: reads the signed-in user's plan from Convex. */
export function PricingModal(props: PricingModalProps) {
  const { isSignedIn, isLoaded } = useUser();
  const billing = useQuery(api.billing.getMyBilling);
  return <PricingModalView {...props} billing={billing} isSignedIn={!!isSignedIn} isLoaded={isLoaded} />;
}

export function PricingModalView({ open, onOpenChange, reason, onUpgraded, billing, isSignedIn, isLoaded }: PricingModalViewProps) {
  const [interval, setInterval] = React.useState<Interval>("monthly");
  const [seats, setSeats] = React.useState(3);
  const [busy, setBusy] = React.useState<PaidTier | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<PaidTier | null>(null);

  const current: Tier = billing?.tier ?? "free";

  const upgrade = async (tier: PaidTier) => {
    if (busy) return;
    setBusy(tier);
    setError(null);
    try {
      const res = await startCheckout({ tier, interval, seats: tier === "team" ? seats : undefined });
      setDone(res.tier);
      onUpgraded?.(res.tier);
    } catch (e) {
      // Closing the Razorpay window is a choice, not a failure.
      if (!(e instanceof CheckoutError && e.code === "dismissed")) setError(e instanceof Error ? e.message : "Something went wrong with the payment.");
    } finally {
      setBusy(null);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return; // don't orphan an open payment
    if (!next) {
      setError(null);
      setDone(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto border border-white/10 bg-[#0c0c0e] p-0 text-white [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin] sm:max-w-[min(64rem,calc(100vw-2rem))]" showCloseButton={!busy}>
        {done ? (
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
              <Check className="h-7 w-7" />
            </span>
            <DialogTitle className="text-xl font-semibold">You&apos;re on {PLANS[done].name}</DialogTitle>
            <DialogDescription className="max-w-sm text-sm text-zinc-400">
              Your plan is active and your AI credits have been refilled. A receipt is on its way from Razorpay.
            </DialogDescription>
            <button type="button" onClick={() => handleOpenChange(false)} className="mt-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200">
              Start building
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-white/10 px-6 pb-5 pt-6 text-center">
              <DialogTitle className="text-xl font-semibold tracking-tight">Pick the plan that fits how you design</DialogTitle>
              <DialogDescription className="mx-auto mt-1.5 max-w-lg text-[13px] text-zinc-400">
                Pay in rupees with cards, UPI or netbanking through Razorpay. Upgrade, switch or cancel whenever you like.
              </DialogDescription>

              {reason && (
                <div className="mx-auto mt-4 flex max-w-xl items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-left text-[12.5px] text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{REASONS[reason]}</span>
                </div>
              )}

              <div className="mx-auto mt-5 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1" role="group" aria-label="Billing interval">
                {(["monthly", "annual"] as Interval[]).map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={interval === i}
                    onClick={() => setInterval(i)}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12.5px] font-semibold capitalize transition-colors ${interval === i ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
                  >
                    {i}
                    {i === "annual" && (
                      <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${interval === "annual" ? "bg-emerald-500/20 text-emerald-700" : "bg-emerald-500/15 text-emerald-300"}`}>
                        Save {annualSavingsPct("pro")}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 p-6 md:grid-cols-3">
              {/* FREE */}
              <PlanCard tier="free" current={current === "free"}>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">{formatInr(0)}</span>
                  <span className="text-[13px] text-zinc-500">/ month</span>
                </div>
                <p className="mt-1 text-[12px] text-zinc-500">Free forever</p>
                <PlanButton disabled variant="ghost">
                  {current === "free" ? "Your current plan" : "Included"}
                </PlanButton>
              </PlanCard>

              {/* PRO + TEAM */}
              {(["pro", "team"] as PaidTier[]).map((tier) => {
                const plan = PLANS[tier];
                const line = priceLine(tier, interval, seats);
                const isCurrent = current === tier;
                const isLower = tierAtLeast(current, tier) && !isCurrent;
                return (
                  <PlanCard key={tier} tier={tier} current={isCurrent} highlight={!!plan.popular}>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-semibold tracking-tight">{line.headline}</span>
                      <span className="text-[13px] text-zinc-500">{line.suffix}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-zinc-500">{line.detail}</p>

                    {plan.perSeat && (
                      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <span className="text-[12.5px] text-zinc-300">Seats</span>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label="Fewer seats" disabled={seats <= 1} onClick={() => setSeats((s) => Math.max(1, s - 1))} className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-[13px] font-semibold tabular-nums" aria-live="polite">
                            {seats}
                          </span>
                          <button type="button" aria-label="More seats" disabled={seats >= MAX_SEATS} onClick={() => setSeats((s) => Math.min(MAX_SEATS, s + 1))} className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {!isLoaded ? (
                      <PlanButton disabled>
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </PlanButton>
                    ) : !isSignedIn ? (
                      <Link href="/sign-in?redirect_url=%2Fdashboard" className="mt-5 flex h-10 w-full items-center justify-center rounded-xl bg-white text-[13px] font-semibold text-black hover:bg-zinc-200">
                        Sign in to upgrade
                      </Link>
                    ) : (
                      <PlanButton disabled={isCurrent || isLower || !!busy} variant={plan.popular ? "primary" : "secondary"} onClick={() => void upgrade(tier)}>
                        {busy === tier ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…
                          </>
                        ) : isCurrent ? (
                          "Your current plan"
                        ) : isLower ? (
                          "Included in your plan"
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" /> {tier === "team" ? `Get Team · ${formatInr(priceFor(tier, interval, seats))}` : `Upgrade to ${plan.name}`}
                          </>
                        )}
                      </PlanButton>
                    )}
                  </PlanCard>
                );
              })}
            </div>

            <div className="flex flex-col items-center gap-2 border-t border-white/10 px-6 py-4 text-center">
              {error && (
                <p role="alert" className="max-w-xl rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">
                  {error}
                </p>
              )}
              {billing?.endsAtPeriodEnd && billing.periodEnd && (
                <p className="text-[12px] text-amber-300">Your {PLANS[billing.tier].name} plan ends on {new Date(billing.periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Subscribe again to keep it.</p>
              )}
              <p className="flex items-center gap-1.5 text-[11.5px] text-zinc-500">
                <ShieldCheck className="h-3.5 w-3.5" /> Payments are processed by Razorpay. Slate never sees your card or UPI details.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({ tier, current, highlight, children }: { tier: Tier; current: boolean; highlight?: boolean; children: React.ReactNode }) {
  const plan = PLANS[tier];
  return (
    <div className={`relative flex flex-col rounded-2xl border p-5 ${highlight ? "border-indigo-400/50 bg-gradient-to-b from-indigo-500/[0.09] to-transparent shadow-[0_0_40px_-12px_rgba(99,102,241,0.5)]" : "border-white/10 bg-white/[0.02]"}`}>
      {highlight && <span className="absolute -top-2.5 left-5 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Most popular</span>}
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
        {current && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">Current</span>}
      </div>
      <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{plan.tagline}</p>
      {children}
      <ul className="mt-5 space-y-2 border-t border-white/10 pt-4 text-[12.5px] text-zinc-300">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanButton({ children, onClick, disabled, variant = "secondary" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:brightness-110",
    secondary: "bg-white text-black hover:bg-zinc-200",
    ghost: "border border-white/10 text-zinc-400",
  }[variant];
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}
