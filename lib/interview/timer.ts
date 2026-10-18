/**
 * Interview countdown as plain data. The remaining time is derived from the clock, never counted by
 * an interval, so it survives reloads, throttled background tabs and a laptop going to sleep.
 */

export const INTERVIEW_DURATION_MS = 45 * 60 * 1000;

export interface TimerState {
  durationMs: number;
  /** Time left when paused; while running, the time left at `startedAt`. */
  remainingMs: number;
  /** Epoch ms of the last start, or null while paused. */
  startedAt: number | null;
}

export type TimerPhase = "idle" | "running" | "paused" | "over";

export function createTimer(durationMs = INTERVIEW_DURATION_MS): TimerState {
  return { durationMs, remainingMs: durationMs, startedAt: null };
}

export function remaining(t: TimerState, now: number): number {
  if (t.startedAt === null) return t.remainingMs;
  return Math.max(0, t.remainingMs - Math.max(0, now - t.startedAt));
}

export function isRunning(t: TimerState): boolean {
  return t.startedAt !== null;
}

export function startTimer(t: TimerState, now: number): TimerState {
  if (t.startedAt !== null || t.remainingMs <= 0) return t;
  return { ...t, startedAt: now };
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  if (t.startedAt === null) return t;
  return { ...t, remainingMs: remaining(t, now), startedAt: null };
}

export function resetTimer(t: TimerState): TimerState {
  return createTimer(t.durationMs);
}

export function phaseOf(t: TimerState, now: number): TimerPhase {
  const left = remaining(t, now);
  if (left <= 0) return "over";
  if (t.startedAt !== null) return "running";
  return left === t.durationMs ? "idle" : "paused";
}

/** Urgency colour band: calm until 10 minutes are left, then amber, then red in the last 3. */
export function urgency(leftMs: number): "calm" | "warning" | "critical" {
  if (leftMs <= 3 * 60 * 1000) return "critical";
  if (leftMs <= 10 * 60 * 1000) return "warning";
  return "calm";
}

/** "44:07"; rounds partial seconds up so the clock never shows 00:00 before time is really up. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Reads a stored timer defensively; anything malformed becomes a fresh timer. */
export function parseTimer(raw: unknown): TimerState {
  if (!raw || typeof raw !== "object") return createTimer();
  const r = raw as Record<string, unknown>;
  const duration = typeof r.durationMs === "number" && r.durationMs >= 60_000 && r.durationMs <= 8 * 3_600_000 ? r.durationMs : INTERVIEW_DURATION_MS;
  const left = typeof r.remainingMs === "number" && Number.isFinite(r.remainingMs) ? Math.min(duration, Math.max(0, r.remainingMs)) : duration;
  const startedAt = typeof r.startedAt === "number" && Number.isFinite(r.startedAt) && r.startedAt > 0 ? r.startedAt : null;
  return { durationMs: duration, remainingMs: left, startedAt };
}
