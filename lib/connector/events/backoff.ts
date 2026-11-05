/**
 * Retry schedule of a failed delivery (CP1 section 5): after attempt 1 wait 10 s, after attempt 2 wait 30 s, then
 * 2 min, 10 min, 30 min, 1 h, 3 h, 6 h. That is the first try plus 8 retries over about 11 hours, each delay
 * jittered by +/-20% so a receiver that comes back is not hit by every queued delivery at the same instant.
 */
export const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000] as const;

/** The most attempts a delivery gets: the first one and one per delay above. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Milliseconds to wait after `attemptsMade` failed attempts, or null when the delivery has used them all. `random` is injectable for tests. */
export function nextDelayMs(attemptsMade: number, random: () => number = Math.random): number | null {
  const base = RETRY_DELAYS_MS[attemptsMade - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + random() * 0.4));
}

/** An endpoint that fails this many attempts in a row is disabled... */
export const DISABLE_AFTER_FAILURES = 50;
/** ...and so is one that has had nothing but failures for this long. */
export const DISABLE_AFTER_MS = 3 * 24 * 60 * 60_000;
