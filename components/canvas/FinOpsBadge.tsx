"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Download, Lightbulb, Lock, Receipt } from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { downloadBlob, safeFilename } from "@/lib/canvas/export";
import { hasFeature, type Tier } from "@/lib/billing/plans";
import { estimateCost, toCsv, type CostEstimate } from "@/lib/finops/estimate";
import { formatUsd, type Provider } from "@/lib/finops/pricing-rules";

const PANEL_WIDTH = 352;
const PROVIDER_LABEL: Record<Provider, string> = { aws: "AWS", gcp: "Google Cloud", azure: "Azure", generic: "Managed services" };
const PROVIDER_DOT: Record<Provider, string> = { aws: "bg-amber-400", gcp: "bg-sky-400", azure: "bg-blue-500", generic: "bg-zinc-400" };

/** Re-render only when the numbers or tips actually changed, not on every drag frame. */
function same(a: CostEstimate, b: CostEstimate): boolean {
  return a.total === b.total && a.items.length === b.items.length && a.unpriced === b.unpriced && a.tips.map((t) => t.id).join() === b.tips.map((t) => t.id).join() && a.items.every((it, i) => it.nodeId === b.items[i].nodeId && it.monthly === b.items[i].monthly);
}

interface FinOpsBadgeProps {
  engine: Engine;
  tier: Tier;
  title: string;
  /** Opens the upgrade flow (or sign-up when the board has no account). */
  onUpgrade: () => void;
}

/**
 * Floating "Estimated cloud cost" badge. Recomputes as nodes are added, removed or relabelled.
 * Everyone sees the monthly total and the optimisation tips; the per-component breakdown and CSV
 * export belong to paid plans.
 */
export function FinOpsBadge({ engine, tier, title, onUpgrade }: FinOpsBadgeProps) {
  const [estimate, setEstimate] = React.useState<CostEstimate>(() => estimateCost(engine.store.list()));
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ left: number; bottom: number; vw: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const itemised = hasFeature(tier, "finopsItemization");
  const csv = hasFeature(tier, "finopsCsv");

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recompute = () => {
      timer = null;
      const next = estimateCost(engine.store.list());
      setEstimate((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(recompute, 250);
    };
    schedule();
    const unsub = engine.store.subscribe(schedule);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [engine]);

  /** The panel is portalled to the page and clamped to the window, so a narrow canvas pane can't clip it. */
  const place = React.useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 8, vw: window.innerWidth });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reposition = () => place();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

  if (estimate.items.length === 0) return null;

  const focusNode = (id: string) => {
    const el = engine.store.get(id);
    if (!el) return;
    engine.select([id]);
    engine.revealPoint({ x: el.x + el.w / 2, y: el.y + el.h / 2 });
  };
  const exportCsv = () => {
    if (!csv) return onUpgrade();
    downloadBlob(new Blob([toCsv(estimate)], { type: "text/csv;charset=utf-8" }), safeFilename(`${title} finops`, "csv"));
  };
  const providers = (Object.entries(estimate.byProvider) as [Provider, number][]).sort((a, b) => b[1] - a[1]);
  const rows = [...estimate.items].sort((a, b) => b.monthly - a.monthly);

  return (
    <div ref={rootRef} className="relative flex flex-col items-start gap-2" onPointerDown={(e) => e.stopPropagation()}>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", bottom: anchor.bottom, left: Math.max(8, Math.min(anchor.left, anchor.vw - Math.min(PANEL_WIDTH, anchor.vw - 16) - 8)), width: Math.min(PANEL_WIDTH, anchor.vw - 16) }}
          className="z-[60] rounded-2xl border border-white/10 bg-[#141416]/95 p-3.5 shadow-2xl backdrop-blur-xl"
          data-slate-ui
          role="dialog"
          aria-label="Cloud cost estimate"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Estimated cloud cost</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums text-white">{formatUsd(estimate.total)}</span>
                <span className="text-[12px] text-zinc-500">/ month</span>
              </div>
              <div className="text-[11px] text-zinc-500">≈ {formatUsd(estimate.total * 12)} / year</div>
            </div>
            <button type="button" onClick={exportCsv} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[11.5px] font-medium text-zinc-200 hover:bg-white/10" title={csv ? "Download the breakdown as CSV" : "CSV export is a Pro feature"}>
              {csv ? <Download className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-zinc-500" />} CSV
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {providers.map(([p, v]) => (
              <span key={p} className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-zinc-300">
                <span className={`h-1.5 w-1.5 rounded-full ${PROVIDER_DOT[p]}`} /> {PROVIDER_LABEL[p]} <span className="tabular-nums text-zinc-500">{formatUsd(v)}</span>
              </span>
            ))}
          </div>

          <div className="mt-3 border-t border-white/10 pt-2.5">
            {itemised ? (
              <ul className="max-h-52 space-y-0.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {rows.map((it) => (
                  <li key={it.nodeId}>
                    <button type="button" onClick={() => focusNode(it.nodeId)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/[0.06]" title={it.rule.assumption}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PROVIDER_DOT[it.rule.provider]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-zinc-100">
                          {it.label}
                          {it.quantity > 1 && <span className="ml-1 text-zinc-500">×{it.quantity}</span>}
                        </span>
                        <span className="block truncate text-[10.5px] text-zinc-500">{it.rule.service}</span>
                      </span>
                      <span className="text-[12px] tabular-nums text-zinc-200">{formatUsd(it.monthly)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="relative overflow-hidden rounded-xl border border-white/[0.07]">
                <ul aria-hidden className="space-y-1.5 p-2.5 opacity-40 blur-[3px]">
                  {rows.slice(0, 4).map((it) => (
                    <li key={it.nodeId} className="flex justify-between text-[12px] text-zinc-300">
                      <span>{it.label}</span>
                      <span>{formatUsd(it.monthly)}</span>
                    </li>
                  ))}
                </ul>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#141416]/60 text-center">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-100">
                    <Lock className="h-3.5 w-3.5" /> Per-component breakdown is a Pro feature
                  </span>
                  <button type="button" onClick={onUpgrade} className="rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110">
                    Upgrade to Pro
                  </button>
                </div>
              </div>
            )}
          </div>

          {estimate.tips.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <Lightbulb className="h-3 w-3 text-amber-400" /> Ways to save
              </div>
              <ul className="space-y-1.5">
                {estimate.tips.map((t) => (
                  <li key={t.id} className="text-[11.5px] leading-snug text-zinc-300">
                    {t.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[10.5px] leading-snug text-zinc-600">
            Public list prices, US regions, 730 hours a month. Hover a row for the assumption.{estimate.unpriced > 0 ? ` ${estimate.unpriced} component${estimate.unpriced === 1 ? "" : "s"} couldn't be priced.` : ""} An estimate, not a quote.
          </p>
        </div>,
        document.body
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={`Estimated cloud cost ${formatUsd(estimate.total)} per month. ${open ? "Hide" : "Show"} breakdown`}
        className={`group flex h-9 items-center gap-2 rounded-xl border bg-[#141416]/90 pl-2.5 pr-2 text-left shadow-xl backdrop-blur-xl transition-colors ${open ? "border-emerald-400/40" : "border-white/10 hover:border-white/20"}`}
      >
        <Receipt className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-[11px] font-medium text-zinc-400 max-sm:hidden">Est. cloud cost</span>
        <span className="text-[13px] font-semibold tabular-nums text-white">{formatUsd(estimate.total)}</span>
        <span className="text-[11px] text-zinc-500">/ mo</span>
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}
