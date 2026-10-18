"use client";

import * as React from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { PLANS, type Tier } from "@/lib/billing/plans";
import { PlanBadge, UsageBar } from "./bits";

export interface MeterBilling {
  tier: Tier;
  boards: { used: number | null; limit: number | null };
  ai: { used: number; cap: number; resetsAt: number };
  endsAtPeriodEnd?: boolean;
  periodEnd?: number | null;
}

/** Sidebar footer: how much of the plan is used, and the way to upgrade it. */
export function UsageMeter({ billing, onUpgrade }: { billing: MeterBilling | null | undefined; onUpgrade: () => void }) {
  if (billing === undefined) {
    return <div className="h-[132px] animate-pulse rounded-xl border border-white/[0.07] bg-[#121215]" aria-label="Loading usage" />;
  }
  // Signed-out or no data: show the free plan's promise instead of an empty box.
  const tier: Tier = billing?.tier ?? "free";
  const boards = billing?.boards ?? { used: 0, limit: PLANS.free.limits.maxBoards };
  const ai: { used: number; cap: number; resetsAt: number | null } = billing?.ai ?? { used: 0, cap: PLANS.free.limits.aiCreditsMonthly, resetsAt: null };
  const nextTier: Tier | null = tier === "free" ? "pro" : tier === "pro" ? "team" : null;
  const resets = ai.resetsAt === null ? "monthly" : `on ${new Date(ai.resetsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#121215] p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Usage</span>
        <PlanBadge tier={tier} />
      </div>
      <div className="space-y-2.5">
        <UsageBar label="Slates created" value={boards.used} max={boards.limit} />
        <UsageBar label="AI credits" value={ai.used} max={ai.cap} />
      </div>
      <p className="mt-2 text-[10.5px] text-zinc-600">AI credits refill {resets}</p>
      {billing?.endsAtPeriodEnd && billing.periodEnd ? (
        <p className="mt-1 text-[10.5px] text-amber-400">Plan ends {new Date(billing.periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
      ) : null}
      <button
        type="button"
        onClick={onUpgrade}
        className={`mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold transition-all ${
          nextTier === "pro" ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-[0_6px_20px_-6px_rgba(139,92,246,0.7)] hover:brightness-110" : "border border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
        }`}
      >
        {nextTier === "pro" ? <Sparkles className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
        {nextTier === "pro" ? "Upgrade to Pro" : nextTier === "team" ? "Upgrade to Team" : "Manage plan"}
      </button>
    </div>
  );
}
