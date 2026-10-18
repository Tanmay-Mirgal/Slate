"use client";

import * as React from "react";
import { AlertTriangle, Calculator, ClipboardCheck, GraduationCap, ListChecks, Loader2, Pause, Play, Plus, RotateCcw, Sparkles, Timer, Trash2, X } from "lucide-react";
import type { DocBridge } from "@/components/editor/doc-bridge";
import { ClientAiError, requestReview } from "@/lib/ai/client";
import type { Engine } from "@/lib/canvas/engine";
import { graphToDsl } from "@/lib/diagram/dsl";
import { graphFromElements } from "@/lib/diagram/extract";
import { flattenChecklist, heuristicReview, type Review } from "@/lib/interview/review";
import { compact, estimateScale, progressOf, type ScaleInputs } from "@/lib/interview/rubric";
import type { InterviewStore } from "@/lib/interview/store";
import { formatClock, isRunning, phaseOf, remaining, urgency } from "@/lib/interview/timer";

export const INTERVIEW_DRAWER_WIDTH = 380;

function useInterviewState(store: InterviewStore) {
  return React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Wall-clock `now`, refreshed 4 times a second while `active`. Never read during render. */
function useTicker(active: boolean, from: number): number {
  const [now, setNow] = React.useState(from);
  React.useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active]);
  return now;
}

/* ------------------------------------------------------------------ timer pill */

interface PillProps {
  store: InterviewStore;
  engine: Engine;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onClose: () => void;
}

/** Floating countdown at the top of the canvas: start / pause / reset, checklist progress, and the drawer toggle. */
export function InterviewPill({ store, engine, drawerOpen, onToggleDrawer, onClose }: PillProps) {
  const state = useInterviewState(store);
  const running = isRunning(state.timer);
  const now = useTicker(running, state.timer.startedAt ?? 0);
  const left = remaining(state.timer, now);
  const phase = phaseOf(state.timer, now);
  const band = urgency(left);
  const progress = progressOf(state.sections);

  // Time is up: stop the clock once and say so.
  const announced = React.useRef(false);
  React.useEffect(() => {
    if (phase === "over" && running && !announced.current) {
      announced.current = true;
      store.pause(Date.now());
      engine.toast("Time's up. Wrap up and walk through your design.");
    }
    if (phase !== "over") announced.current = false;
  }, [phase, running, store, engine]);

  const tone =
    phase === "over" || band === "critical" ? "border-red-500/40 text-red-300" : band === "warning" ? "border-amber-400/40 text-amber-200" : "border-white/10 text-white";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[68px] z-30 flex justify-center px-3 max-md:top-[60px] @max-lg:top-[112px]" onPointerDown={(e) => e.stopPropagation()}>
      <div className={`pointer-events-auto flex items-center gap-1 rounded-2xl border bg-[#141416]/92 p-1.5 shadow-xl backdrop-blur-xl ${tone}`} role="timer" aria-label="Interview timer">
        <span className="flex items-center gap-1.5 pl-2 pr-1.5">
          <GraduationCap className="h-4 w-4 opacity-70 @max-xs:hidden" />
          <span className={`min-w-[3.4rem] text-[15px] font-semibold tabular-nums ${band === "critical" && running ? "motion-safe:animate-pulse" : ""}`} aria-live="off">
            {phase === "over" ? "00:00" : formatClock(left)}
          </span>
        </span>

        {phase === "over" ? (
          <span className="rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-red-300">Time&apos;s up</span>
        ) : (
          <button
            type="button"
            onClick={() => (running ? store.pause() : store.start())}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-white px-3 text-[12px] font-semibold text-black hover:bg-zinc-200"
            aria-label={running ? "Pause interview timer" : phase === "idle" ? "Start interview timer" : "Resume interview timer"}
          >
            {running ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            <span className="@max-sm:hidden">{running ? "Pause" : phase === "idle" ? "Start" : "Resume"}</span>
          </button>
        )}
        <button type="button" onClick={() => store.reset()} disabled={phase === "idle"} title="Reset to 45:00" aria-label="Reset timer" className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-300 hover:bg-white/10 disabled:opacity-30 @max-xs:hidden">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-5 w-px bg-white/10" />
        <button
          type="button"
          onClick={onToggleDrawer}
          aria-pressed={drawerOpen}
          className={`flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-semibold transition-colors ${drawerOpen ? "bg-white/15 text-white" : "text-zinc-300 hover:bg-white/10"}`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          <span className="tabular-nums">
            {progress.done}/{progress.total}
          </span>
          <span className="@max-md:hidden">Checklist</span>
        </button>
        <button type="button" onClick={onClose} title="Leave interview mode" aria-label="Leave interview mode" className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 hover:bg-white/10 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- drawer */

type Tab = "checklist" | "scale" | "review";

interface DrawerProps {
  store: InterviewStore;
  engine: Engine;
  docBridge?: DocBridge;
  open: boolean;
  onClose: () => void;
  /** Distance from the right edge, so it sits beside the AI panel instead of under it. */
  rightOffset: number;
  signedIn: boolean;
  onUpgrade?: () => void;
}

export function InterviewDrawer({ store, engine, docBridge, open, onClose, rightOffset, signedIn, onUpgrade }: DrawerProps) {
  const state = useInterviewState(store);
  const [tab, setTab] = React.useState<Tab>("checklist");
  const progress = progressOf(state.sections);

  return (
    <aside
      aria-hidden={!open}
      aria-label="Interview checklist"
      inert={!open}
      className={`absolute top-0 z-50 flex h-full max-w-full flex-col border-l border-white/10 bg-[#0c0c0e]/95 shadow-2xl backdrop-blur-xl transition-[transform,visibility] duration-300 ease-out ${open ? "visible translate-x-0" : "invisible translate-x-full"}`}
      style={{ width: INTERVIEW_DRAWER_WIDTH, right: rightOffset }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-zinc-300">
          <GraduationCap className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-white">System design interview</h2>
          <p className="text-[11px] text-zinc-500">
            {progress.done} of {progress.total} covered
          </p>
        </div>
        <button type="button" aria-label="Close interview panel" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-white/10 p-2" role="tablist">
        {(
          [
            ["checklist", "Checklist", ListChecks],
            ["scale", "Estimate", Calculator],
            ["review", "Review", ClipboardCheck],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors ${tab === id ? "bg-white text-black" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
        {tab === "checklist" && <ChecklistTab store={store} />}
        {tab === "scale" && <ScaleTab store={store} />}
        {tab === "review" && <ReviewTab store={store} engine={engine} docBridge={docBridge} signedIn={signedIn} onUpgrade={onUpgrade} />}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------- checklist */

function ChecklistTab({ store }: { store: InterviewStore }) {
  const state = useInterviewState(store);
  const [openNote, setOpenNote] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  return (
    <div className="space-y-5">
      {state.sections.map((section) => {
        const done = section.items.filter((i) => i.done).length;
        return (
          <section key={section.id}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <h3 className="text-[12.5px] font-semibold text-white">{section.title}</h3>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {done}/{section.items.length}
              </span>
            </div>
            <p className="mb-2 text-[11.5px] leading-snug text-zinc-500">{section.hint}</p>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
                  <div className="flex items-start gap-2 px-2.5 py-2">
                    <input type="checkbox" checked={item.done} onChange={() => store.toggleItem(section.id, item.id)} aria-label={item.text} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500" />
                    <button type="button" onClick={() => setOpenNote(openNote === item.id ? null : item.id)} className={`flex-1 text-left text-[12.5px] leading-snug ${item.done ? "text-zinc-500 line-through" : "text-zinc-200"}`} title="Add a note">
                      {item.text}
                      {item.note && openNote !== item.id && <span className="mt-0.5 block text-[11.5px] no-underline text-indigo-300/90">{item.note}</span>}
                    </button>
                    {item.id.startsWith("c") && (
                      <button type="button" aria-label="Remove item" onClick={() => store.removeItem(section.id, item.id)} className="rounded p-0.5 text-zinc-600 hover:text-red-400">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {openNote === item.id && (
                    <div className="px-2.5 pb-2">
                      <textarea
                        autoFocus
                        rows={2}
                        value={item.note}
                        onChange={(e) => store.setNote(section.id, item.id, e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Your answer: e.g. 10M DAU, p99 < 200 ms"
                        className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-400/50"
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="mt-1.5 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                store.addItem(section.id, drafts[section.id] ?? "");
                setDrafts((d) => ({ ...d, [section.id]: "" }));
              }}
            >
              <input
                value={drafts[section.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [section.id]: e.target.value }))}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Add your own item"
                aria-label={`Add an item to ${section.title}`}
                maxLength={200}
                className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-400/50"
              />
              <button type="submit" aria-label="Add item" className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:bg-white/10">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- scale */

const SCALE_FIELDS: { key: keyof ScaleInputs; label: string; unit?: string; step?: number; max: number }[] = [
  { key: "dau", label: "Daily active users", max: 1e10 },
  { key: "actionsPerUser", label: "Requests per user per day", max: 1e5 },
  { key: "readPct", label: "Reads", unit: "%", max: 100 },
  { key: "payloadKb", label: "Average payload", unit: "KB", step: 0.5, max: 1e6 },
  { key: "retentionYears", label: "Retention", unit: "years", max: 50 },
  { key: "peakFactor", label: "Peak vs average", unit: "×", step: 0.5, max: 100 },
];

function ScaleTab({ store }: { store: InterviewStore }) {
  const { scale } = useInterviewState(store);
  const e = estimateScale(scale);
  const rows: [string, string, string][] = [
    ["Average load", `${compact(e.avgQps)} req/s`, `${compact(e.readQps)} reads · ${compact(e.writeQps)} writes`],
    ["Peak load", `${compact(e.peakQps)} req/s`, `${scale.peakFactor}× the average`],
    ["Storage growth", `${compact(e.storageGbPerYear)} GB / year`, `${compact(e.totalStorageTb)} TB over ${scale.retentionYears} years`],
    ["Peak egress", `${compact(e.peakBandwidthMbps)} Mbit/s`, "reads only"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-snug text-zinc-500">Back-of-the-envelope numbers to justify your design. Change an assumption and everything updates.</p>
      <div className="grid grid-cols-2 gap-2">
        {SCALE_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-500">{f.label}</span>
            <span className="flex items-center rounded-lg border border-white/10 bg-black/30 focus-within:border-indigo-400/50">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={f.max}
                step={f.step ?? 1}
                value={Number.isFinite(scale[f.key]) ? scale[f.key] : 0}
                onChange={(ev) => store.setScale({ [f.key]: Math.min(f.max, Math.max(0, Number(ev.target.value) || 0)) })}
                onKeyDown={(ev) => ev.stopPropagation()}
                className="h-8 w-full min-w-0 bg-transparent px-2 text-[12.5px] tabular-nums text-zinc-100 outline-none"
              />
              {f.unit && <span className="pr-2 text-[11px] text-zinc-600">{f.unit}</span>}
            </span>
          </label>
        ))}
      </div>
      <dl className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-white/[0.02]">
        {rows.map(([name, value, hint]) => (
          <div key={name} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
            <div>
              <dt className="text-[11.5px] text-zinc-500">{name}</dt>
              <dd className="text-[10.5px] text-zinc-600">{hint}</dd>
            </div>
            <dd className="text-[14px] font-semibold tabular-nums text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------------- review */

function ScoreBar({ score }: { score: number }) {
  const tone = score >= 7 ? "bg-emerald-500" : score >= 4 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={score}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${score * 10}%` }} />
    </div>
  );
}

function ReviewView({ review }: { review: Review }) {
  const ring = review.score >= 70 ? "text-emerald-400" : review.score >= 40 ? "text-amber-300" : "text-red-400";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
        <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border-2 border-current ${ring}`}>
          <span className="text-lg font-bold leading-none tabular-nums">{review.score}</span>
          <span className="text-[9px] uppercase tracking-wide opacity-70">/ 100</span>
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] leading-snug text-zinc-200">{review.summary}</p>
          <p className="mt-1 text-[10.5px] text-zinc-600">{review.source === "ai" ? `AI review${review.model ? ` · ${review.model}` : ""}` : "Structural check · no AI used"}</p>
        </div>
      </div>

      {review.categories.map((c) => (
        <div key={c.id}>
          <div className="mb-1 flex items-baseline justify-between">
            <h4 className="text-[12.5px] font-semibold text-white">{c.name}</h4>
            <span className="text-[11.5px] tabular-nums text-zinc-400">{c.score}/10</span>
          </div>
          <ScoreBar score={c.score} />
          {c.feedback && <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">{c.feedback}</p>}
          {c.suggestions.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {c.suggestions.map((s) => (
                <li key={s} className="text-[11.5px] leading-snug text-indigo-200/90">
                  → {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {review.strengths.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-400/80">Strengths</h4>
          <ul className="space-y-0.5">
            {review.strengths.map((s) => (
              <li key={s} className="text-[12px] leading-snug text-zinc-300">
                ✓ {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.gaps.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">Gaps</h4>
          <ul className="space-y-0.5">
            {review.gaps.map((s) => (
              <li key={s} className="text-[12px] leading-snug text-zinc-300">
                • {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReviewTab({ store, engine, docBridge, signedIn, onUpgrade }: { store: InterviewStore; engine: Engine; docBridge?: DocBridge; signedIn: boolean; onUpgrade?: () => void }) {
  const state = useInterviewState(store);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; code: string } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const quick = () => {
    setError(null);
    store.setReview(heuristicReview(engine.store.list(), state.sections));
  };

  const ai = async () => {
    const els = engine.store.list();
    const graph = graphFromElements(els);
    if (graph.nodes.length < 2) {
      setError({ message: "Draw at least two connected components first, then ask for a review.", code: "empty_board" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const notes = docBridge?.markdown().slice(0, 5000);
      const { review, model } = await requestReview({ dsl: graphToDsl(graph), checklist: flattenChecklist(state.sections), notes }, controller.signal);
      store.setReview({ ...review, model: review.model ?? model });
    } catch (e) {
      const err = e instanceof ClientAiError ? e : new ClientAiError("upstream", e instanceof Error ? e.message : "Something went wrong");
      if (err.code !== "aborted") setError({ message: err.message, code: err.code });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-snug text-zinc-500">Get feedback on your diagram against the usual rubric: scalability, availability, data, caching and trade-offs.</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={quick} className="flex h-10 flex-col items-center justify-center rounded-xl border border-white/10 text-[12px] font-semibold text-zinc-200 hover:bg-white/10">
          Quick check
          <span className="text-[10px] font-normal text-zinc-500">instant · free</span>
        </button>
        <button
          type="button"
          onClick={() => void ai()}
          disabled={busy || !signedIn}
          title={signedIn ? undefined : "Sign in to use the AI reviewer"}
          className="flex h-10 flex-col items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {busy ? "Reviewing…" : "AI review"}
          </span>
          <span className="text-[10px] font-normal opacity-80">1 AI credit</span>
        </button>
      </div>
      {!signedIn && <p className="text-[11.5px] text-amber-300/90">Sign in to get the written AI review. The quick check works without an account.</p>}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {error.message}
            {error.code === "credits_exhausted" && onUpgrade && (
              <button type="button" onClick={onUpgrade} className="mt-1.5 block rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-semibold text-black hover:bg-zinc-200">
                See plans
              </button>
            )}
          </div>
        </div>
      )}

      {state.review ? (
        <ReviewView review={state.review} />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-zinc-500">
          <Timer className="h-5 w-5" />
          <p className="text-[12px]">Your review will appear here.</p>
        </div>
      )}
    </div>
  );
}
