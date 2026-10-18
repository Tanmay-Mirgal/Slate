import type { ThreadFilter, ThreadSummary } from "./types";

export const FILTERS: { id: ThreadFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "unread", label: "Unread" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

export function matchesFilter(t: ThreadSummary, filter: ThreadFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return t.status === "open";
    case "resolved":
      return t.status === "resolved";
    case "unread":
      return t.unread;
  }
}

/**
 * Threads for the side panel: filtered, with open ones above resolved ones, then newest activity
 * first (unread and "mentions you" threads float to the top of their group).
 */
export function visibleThreads(threads: readonly ThreadSummary[], filter: ThreadFilter): ThreadSummary[] {
  const rank = (t: ThreadSummary) => (t.status === "resolved" ? 2 : 0) + (t.unread || t.mentionsMe ? 0 : 1);
  return threads
    .filter((t) => matchesFilter(t, filter))
    .sort((a, b) => rank(a) - rank(b) || b.lastActivityAt - a.lastActivityAt);
}

export function filterCounts(threads: readonly ThreadSummary[]): Record<ThreadFilter, number> {
  const out: Record<ThreadFilter, number> = { all: threads.length, open: 0, unread: 0, resolved: 0 };
  for (const t of threads) {
    if (t.status === "open") out.open++;
    else out.resolved++;
    if (t.unread) out.unread++;
  }
  return out;
}
