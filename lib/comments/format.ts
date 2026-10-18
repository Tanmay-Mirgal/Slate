const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "5m", "3h", "2d", then a short date. Compact on purpose: it sits next to names. */
export function timeAgo(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 45_000) return "just now";
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))}m`;
  if (d < DAY) return `${Math.round(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.round(d / DAY)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(ts).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

/** "Today, 3:42 PM" / "Yesterday, 9:05 AM" / "Mar 4, 3:42 PM". */
export function dayTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(n) - startOf(d)) / DAY);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== n.getFullYear() ? { year: "numeric" } : {}) });
  return `${date}, ${time}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
