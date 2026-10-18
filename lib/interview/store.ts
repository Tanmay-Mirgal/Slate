import { createTimer, parseTimer, pauseTimer, resetTimer, startTimer, type TimerState } from "./timer";
import { DEFAULT_SCALE, defaultSections, parseSections, type ChecklistSection, type ScaleInputs } from "./rubric";
import type { Review } from "./review";

/**
 * Everything the interview mode remembers for one board. Kept per board in localStorage so a reload
 * (or a laptop sleeping through a break) doesn't lose the clock or the checklist.
 */

export interface InterviewState {
  enabled: boolean;
  timer: TimerState;
  sections: ChecklistSection[];
  scale: ScaleInputs;
  review: Review | null;
}

export const STORAGE_PREFIX = "slate_interview_v1:";

export function defaultInterviewState(): InterviewState {
  return { enabled: false, timer: createTimer(), sections: defaultSections(), scale: { ...DEFAULT_SCALE }, review: null };
}

function parseScale(raw: unknown): ScaleInputs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SCALE };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    dau: num(r.dau, DEFAULT_SCALE.dau),
    actionsPerUser: num(r.actionsPerUser, DEFAULT_SCALE.actionsPerUser),
    readPct: num(r.readPct, DEFAULT_SCALE.readPct),
    payloadKb: num(r.payloadKb, DEFAULT_SCALE.payloadKb),
    retentionYears: num(r.retentionYears, DEFAULT_SCALE.retentionYears),
    peakFactor: num(r.peakFactor, DEFAULT_SCALE.peakFactor),
  };
}

export function parseInterviewState(raw: unknown): InterviewState {
  const base = defaultInterviewState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const review = r.review && typeof r.review === "object" && Array.isArray((r.review as { categories?: unknown }).categories) ? (r.review as Review) : null;
  return {
    enabled: r.enabled === true,
    timer: parseTimer(r.timer),
    sections: parseSections(r.sections),
    scale: parseScale(r.scale),
    review,
  };
}

/** A tiny observable store (no React) so the timer pill and the drawer share state and persistence. */
export class InterviewStore {
  private state: InterviewState = defaultInterviewState();
  private key: string | null = null;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  getState = (): InterviewState => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Switches to a board's saved state (or a fresh one). */
  load(key: string) {
    if (this.key === key) return;
    this.flush();
    this.key = key;
    let next = defaultInterviewState();
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (raw) next = parseInterviewState(JSON.parse(raw));
    } catch {
      /* private mode or corrupt value: start fresh */
    }
    this.state = next;
    this.emit();
  }

  update(fn: (s: InterviewState) => InterviewState) {
    this.state = fn(this.state);
    this.emit();
    this.scheduleSave();
  }

  setEnabled(enabled: boolean) {
    this.update((s) => ({ ...s, enabled }));
  }

  start(now = Date.now()) {
    this.update((s) => ({ ...s, timer: startTimer(s.timer, now) }));
  }

  pause(now = Date.now()) {
    this.update((s) => ({ ...s, timer: pauseTimer(s.timer, now) }));
  }

  reset() {
    this.update((s) => ({ ...s, timer: resetTimer(s.timer) }));
  }

  toggleItem(sectionId: string, itemId: string) {
    this.mapItems(sectionId, (items) => items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)));
  }

  setNote(sectionId: string, itemId: string, note: string) {
    this.mapItems(sectionId, (items) => items.map((i) => (i.id === itemId ? { ...i, note: note.slice(0, 500) } : i)));
  }

  addItem(sectionId: string, text: string) {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    this.mapItems(sectionId, (items) => (items.length >= 40 ? items : [...items, { id: `c${Date.now().toString(36)}${items.length}`, text: clean, done: false, note: "" }]));
  }

  removeItem(sectionId: string, itemId: string) {
    this.mapItems(sectionId, (items) => items.filter((i) => i.id !== itemId));
  }

  setScale(patch: Partial<ScaleInputs>) {
    this.update((s) => ({ ...s, scale: { ...s.scale, ...patch } }));
  }

  setReview(review: Review | null) {
    this.update((s) => ({ ...s, review }));
  }

  private mapItems(sectionId: string, fn: (items: ChecklistSection["items"]) => ChecklistSection["items"]) {
    this.update((s) => ({ ...s, sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, items: fn(sec.items) } : sec)) }));
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  /** Writes pending changes now (also called before switching boards and on unload). */
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.key) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + this.key, JSON.stringify(this.state));
    } catch {
      /* storage full or unavailable: the session still works */
    }
  }
}
