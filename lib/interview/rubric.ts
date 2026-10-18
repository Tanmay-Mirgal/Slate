/** The requirement checklist a candidate works through, plus a back-of-the-envelope scale calculator. */

export type SectionId = "functional" | "scale" | "sla" | "data" | "deepdive";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Free-form answer the candidate jots down ("DAU 10M, p99 < 200 ms"). */
  note: string;
}

export interface ChecklistSection {
  id: SectionId;
  title: string;
  hint: string;
  items: ChecklistItem[];
}

const item = (id: string, text: string): ChecklistItem => ({ id, text, done: false, note: "" });

export function defaultSections(): ChecklistSection[] {
  return [
    {
      id: "functional",
      title: "Functional requirements",
      hint: "Agree what the system must do before drawing anything.",
      items: [
        item("f1", "Clarify the users and the core use cases"),
        item("f2", "List the top features in scope, and what is out of scope"),
        item("f3", "Define the main entities and APIs"),
      ],
    },
    {
      id: "scale",
      title: "Scale & throughput",
      hint: "Turn users into requests per second and bytes.",
      items: [
        item("s1", "Estimate daily active users and requests per second"),
        item("s2", "Pin down the read : write ratio and peak vs average load"),
        item("s3", "Estimate storage and bandwidth per year"),
      ],
    },
    {
      id: "sla",
      title: "Latency & availability SLAs",
      hint: "Targets that justify the design choices.",
      items: [
        item("l1", "Agree p99 latency targets for reads and writes"),
        item("l2", "Choose an availability target (99.9% vs 99.99%) and what degrades first"),
        item("l3", "Decide where strong consistency is required and where eventual is fine"),
      ],
    },
    {
      id: "data",
      title: "Data & architecture",
      hint: "The boxes and arrows.",
      items: [
        item("d1", "Choose the data model and storage, and say why (SQL vs NoSQL)"),
        item("d2", "Draw the high-level components and data flow"),
        item("d3", "Place a cache and a queue where they earn their keep"),
      ],
    },
    {
      id: "deepdive",
      title: "Deep dives & trade-offs",
      hint: "Show depth on the hardest part.",
      items: [
        item("x1", "Deep dive one bottleneck (sharding, hot keys, fan-out)"),
        item("x2", "Walk through failure modes: single points of failure, retries, back-pressure"),
        item("x3", "Cover monitoring, security and cost trade-offs"),
      ],
    },
  ];
}

export function progressOf(sections: ChecklistSection[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of sections) {
    for (const i of s.items) {
      total++;
      if (i.done) done++;
    }
  }
  return { done, total };
}

/** Restores saved sections, keeping the user's progress but tolerating missing or malformed data. */
export function parseSections(raw: unknown): ChecklistSection[] {
  const base = defaultSections();
  if (!Array.isArray(raw)) return base;
  const out: ChecklistSection[] = [];
  for (const def of base) {
    const saved = raw.find((s) => s && typeof s === "object" && (s as { id?: unknown }).id === def.id) as { items?: unknown } | undefined;
    if (!saved || !Array.isArray(saved.items)) {
      out.push(def);
      continue;
    }
    const items: ChecklistItem[] = [];
    for (const it of saved.items.slice(0, 40)) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.text !== "string" || !o.text.trim()) continue;
      items.push({ id: o.id.slice(0, 40), text: o.text.slice(0, 200), done: o.done === true, note: typeof o.note === "string" ? o.note.slice(0, 500) : "" });
    }
    out.push({ ...def, items: items.length ? items : def.items });
  }
  return out;
}

/* ------------------------------------------------------------------ calculator */

export interface ScaleInputs {
  /** Daily active users. */
  dau: number;
  /** Actions per user per day. */
  actionsPerUser: number;
  /** Share of actions that are reads, 0..100. */
  readPct: number;
  /** Average payload size in KB. */
  payloadKb: number;
  /** How many years of data to keep. */
  retentionYears: number;
  /** Peak traffic as a multiple of the average. */
  peakFactor: number;
}

export const DEFAULT_SCALE: ScaleInputs = { dau: 10_000_000, actionsPerUser: 20, readPct: 90, payloadKb: 2, retentionYears: 5, peakFactor: 3 };

export interface ScaleEstimate {
  avgQps: number;
  peakQps: number;
  readQps: number;
  writeQps: number;
  /** Storage growth, GB per year (writes only). */
  storageGbPerYear: number;
  totalStorageTb: number;
  /** Peak egress, Mbit/s (reads only). */
  peakBandwidthMbps: number;
}

const SECONDS_PER_DAY = 86_400;

export function estimateScale(i: ScaleInputs): ScaleEstimate {
  const safe = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);
  const dau = safe(i.dau, 0, 1e10);
  const actions = safe(i.actionsPerUser, 0, 1e6);
  const readFrac = safe(i.readPct, 0, 100) / 100;
  const kb = safe(i.payloadKb, 0, 1e6);
  const years = safe(i.retentionYears, 0, 100);
  const peak = safe(i.peakFactor, 1, 100);

  const avgQps = (dau * actions) / SECONDS_PER_DAY;
  const readQps = avgQps * readFrac;
  const writeQps = avgQps - readQps;
  const writesPerYear = writeQps * SECONDS_PER_DAY * 365;
  const storageGbPerYear = (writesPerYear * kb) / 1024 / 1024;
  return {
    avgQps,
    peakQps: avgQps * peak,
    readQps,
    writeQps,
    storageGbPerYear,
    totalStorageTb: (storageGbPerYear * years) / 1024,
    peakBandwidthMbps: (readQps * peak * kb * 8) / 1024,
  };
}

/** 12,345 -> "12.3K"; 1,200,000 -> "1.2M". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const trim = (v: number) => {
    const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  };
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n) || "0";
}
