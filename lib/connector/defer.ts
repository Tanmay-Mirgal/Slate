import { after } from "next/server";

/** Work started by a fallback (outside a Next request, e.g. in tests or scripts), so callers can wait for it. */
const inflight = new Set<Promise<void>>();

/**
 * Runs `task` once the response has been sent (Next's `after`), best effort: a failure is logged, never
 * surfaced. Outside a request (tests, scripts) it simply starts the task right away.
 */
export function deferTask(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (e) {
      console.error("[connector] deferred task failed:", e instanceof Error ? e.message : e);
    }
  };
  try {
    after(run);
  } catch {
    const p = run().finally(() => inflight.delete(p));
    inflight.add(p);
  }
}

/** Waits for every task `deferTask` had to start itself (tests). */
export async function settleDeferred(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight]);
}
