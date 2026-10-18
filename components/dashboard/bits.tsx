"use client";

import * as React from "react";
import type { Tier } from "@/lib/billing/plans";

/** Small shared pieces of the dashboard: plan pill, workspace avatar, usage bar. */

const GRADIENTS = [
  "from-indigo-500 to-fuchsia-500",
  "from-sky-500 to-indigo-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-rose-500",
  "from-violet-500 to-sky-500",
  "from-rose-500 to-orange-500",
];

export function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

export function PlanBadge({ tier, className = "" }: { tier: Tier; className?: string }) {
  const styles: Record<Tier, string> = {
    free: "border border-white/10 bg-white/[0.04] text-zinc-400",
    pro: "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-[0_0_12px_-2px_rgba(139,92,246,0.7)]",
    team: "bg-gradient-to-r from-emerald-500 to-cyan-500 text-black",
  };
  return <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${styles[tier]} ${className}`}>{tier}</span>;
}

export function WorkspaceAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = (name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("") || "W").toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br font-bold text-white shadow-inner ${gradientFor(name)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Progress bar that warms up as the limit nears. `value` and `max` are counts; `max: null` renders as unlimited. */
export function UsageBar({ label, value, max, suffix }: { label: string; value: number | null; max: number | null; suffix?: string }) {
  const unlimited = max === null;
  const pct = unlimited || value === null ? 0 : Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const tone = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-indigo-500";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-300">
          {unlimited ? (value === null ? "Unlimited" : `${value} · Unlimited`) : `${value ?? 0} / ${max}`}
          {suffix ? <span className="ml-1 text-zinc-500">{suffix}</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max ?? undefined} aria-valuenow={value ?? 0}>
        <div className={`h-full rounded-full transition-all duration-500 ${unlimited ? "bg-gradient-to-r from-indigo-500/60 to-fuchsia-500/60" : tone}`} style={{ width: unlimited ? "100%" : `${Math.max(pct, value ? 4 : 0)}%` }} />
      </div>
    </div>
  );
}
