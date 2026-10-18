import { buildTopology, findSpofs } from "../simulation/topology";
import type { El } from "../canvas/types";
import { progressOf, type ChecklistSection } from "./rubric";

/**
 * Architecture review for the interview mode. Two sources produce the same shape:
 *   - `heuristicReview`: instant and free, reads the diagram's structure (load balancers, caches,
 *     replicas, single points of failure, how much of the checklist is done)
 *   - the AI reviewer (`app/api/ai/review-architecture`), which grades the same rubric in prose
 * The rubric mirrors what interviewers actually look at.
 */

export const REVIEW_CATEGORIES = [
  { id: "scalability", name: "Scalability" },
  { id: "availability", name: "High availability" },
  { id: "data", name: "Data & sharding" },
  { id: "caching", name: "Caching & performance" },
  { id: "tradeoffs", name: "Requirements & trade-offs" },
] as const;

export type CategoryId = (typeof REVIEW_CATEGORIES)[number]["id"];

export interface CategoryScore {
  id: CategoryId;
  name: string;
  /** 0 to 10. */
  score: number;
  feedback: string;
  suggestions: string[];
}

export interface Review {
  source: "heuristic" | "ai";
  /** 0 to 100. */
  score: number;
  summary: string;
  categories: CategoryScore[];
  strengths: string[];
  gaps: string[];
  model?: string;
  createdAt: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen: number) => (Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);

export function overallScore(categories: CategoryScore[]): number {
  if (categories.length === 0) return 0;
  return Math.round((categories.reduce((n, c) => n + c.score, 0) / (categories.length * 10)) * 100);
}

/** Accepts whatever JSON a model produced and returns a complete, bounded Review. */
export function normalizeReview(raw: unknown, model?: string, now = Date.now()): Review | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawCats = Array.isArray(r.categories) ? r.categories : [];
  const categories: CategoryScore[] = REVIEW_CATEGORIES.map((def) => {
    const found = rawCats.find((c) => c && typeof c === "object" && String((c as { id?: unknown }).id ?? (c as { name?: unknown }).name ?? "").toLowerCase().replace(/[^a-z]/g, "").startsWith(def.id.slice(0, 5))) as Record<string, unknown> | undefined;
    const score = found ? Number(found.score) : Number.NaN;
    return {
      id: def.id,
      name: def.name,
      score: Number.isFinite(score) ? clamp(Math.round(score), 0, 10) : 0,
      feedback: found ? str(found.feedback ?? found.comment, 400) : "",
      suggestions: found ? strList(found.suggestions ?? found.improvements, 4, 200) : [],
    };
  });
  if (categories.every((c) => c.score === 0 && !c.feedback)) return null;
  const given = Number(r.score);
  return {
    source: "ai",
    score: Number.isFinite(given) ? clamp(Math.round(given), 0, 100) : overallScore(categories),
    summary: str(r.summary, 600),
    categories,
    strengths: strList(r.strengths, 5, 200),
    gaps: strList(r.gaps ?? r.weaknesses, 5, 200),
    model,
    createdAt: now,
  };
}

/** Instant, offline review from the shape of the diagram and the state of the checklist. */
export function heuristicReview(els: El[], sections: ChecklistSection[], now = Date.now()): Review {
  const topo = buildTopology(els);
  const nodes = Array.from(topo.nodes.values());
  const has = (...kinds: string[]) => nodes.some((n) => kinds.includes(n.kind));
  const count = (kind: string) => nodes.filter((n) => n.kind === kind).length;
  const replicated = nodes.filter((n) => n.copies > 1 || n.redundantByNature);
  const spofs = findSpofs(els);
  const high = spofs.filter((s) => s.severity === "high").length;
  const progress = progressOf(sections);
  const strengths: string[] = [];
  // Gaps are gathered per category and merged in rubric order, so one noisy area can't crowd out the others.
  const gapsBy: Record<CategoryId, string[]> = { scalability: [], availability: [], data: [], caching: [], tradeoffs: [] };

  if (nodes.length < 3) {
    return {
      source: "heuristic",
      score: 0,
      summary: "There isn't enough on the canvas to review yet. Connect at least three components, then run the check again.",
      categories: REVIEW_CATEGORIES.map((c) => ({ id: c.id, name: c.name, score: 0, feedback: "Nothing to assess yet.", suggestions: [] })),
      strengths: [],
      gaps: ["Draw the high-level components and connect them with arrows."],
      createdAt: now,
    };
  }

  // Scalability: something that spreads load, something that absorbs bursts, scale-out compute.
  let scalability = 2;
  if (has("loadbalancer", "gateway")) scalability += 3;
  else gapsBy.scalability.push("No load balancer or API gateway in front of the services.");
  if (has("queue")) scalability += 2;
  else gapsBy.scalability.push("No queue or event stream to absorb bursts and decouple services.");
  if (nodes.some((n) => n.kind === "compute" && (n.copies > 1 || n.redundantByNature))) scalability += 2;
  if (has("edge")) scalability += 1;
  if (scalability >= 7) strengths.push("Load is spread across entry points and scalable compute.");

  // Availability: fewer unprotected hot spots is better.
  const availability = clamp(10 - high * 3 - (spofs.length - high), 0, 10);
  if (spofs.length === 0) strengths.push("No single points of failure found on the connected components.");
  for (const s of spofs.slice(0, 1)) gapsBy.availability.push(`${s.message}.`);

  // Data: a store, a way to scale it, and somewhere for blobs.
  let data = 0;
  if (has("database")) data += 4;
  else gapsBy.data.push("No database or durable data store on the diagram.");
  if (nodes.some((n) => n.kind === "database" && n.copies > 1)) {
    data += 3;
    strengths.push("The data tier is replicated.");
  } else if (has("database")) gapsBy.data.push("The data store has no replica or sharding story.");
  if (nodes.some((n) => /shard|partition/i.test(`${n.label} ${n.text.subtitle}`))) data += 2;
  if (has("storage")) data += 1;
  data = clamp(data, 0, 10);

  // Caching: an in-memory cache and/or a CDN.
  let caching = 0;
  if (has("cache")) {
    caching += 6;
    strengths.push("A cache sits in the read path.");
  } else gapsBy.caching.push("No cache: hot reads will hit the database directly.");
  if (has("edge")) caching += 4;
  caching = clamp(caching, 0, 10);

  // Requirements & trade-offs: how much of the checklist the candidate actually worked through.
  const tradeoffs = progress.total === 0 ? 0 : clamp(Math.round((progress.done / progress.total) * 10), 0, 10);
  if (progress.done < progress.total / 2) gapsBy.tradeoffs.push(`Only ${progress.done} of ${progress.total} checklist items are done.`);
  else strengths.push(`${progress.done} of ${progress.total} checklist items covered.`);

  const categories: CategoryScore[] = [
    {
      id: "scalability",
      name: "Scalability",
      score: clamp(scalability, 0, 10),
      feedback: has("loadbalancer", "gateway") ? "Traffic enters through a balancing layer." : "Requests reach services directly, so one instance bounds throughput.",
      suggestions: [!has("loadbalancer", "gateway") && "Put a load balancer or gateway in front of the services.", !has("queue") && "Move slow or bursty work behind a queue.", count("compute") > 0 && !replicated.some((n) => n.kind === "compute") && "Show the services as horizontally scaled (for example x3 or an autoscaling group)."].filter(Boolean) as string[],
    },
    {
      id: "availability",
      name: "High availability",
      score: availability,
      feedback: spofs.length === 0 ? "No obvious single points of failure." : `${spofs.length} component${spofs.length === 1 ? "" : "s"} could take others down if ${spofs.length === 1 ? "it" : "they"} failed.`,
      suggestions: spofs.slice(0, 3).map((s) => `Add a replica or standby for ${s.label}.`),
    },
    {
      id: "data",
      name: "Data & sharding",
      score: data,
      feedback: has("database") ? (data >= 7 ? "The data tier is replicated and thought through." : "A data store exists but its scaling story is missing.") : "The design doesn't show where data lives.",
      suggestions: [!has("database") && "Add the system of record and say why you chose it.", has("database") && data < 7 && "Explain replication and how you would shard when one node is not enough."].filter(Boolean) as string[],
    },
    {
      id: "caching",
      name: "Caching & performance",
      score: caching,
      feedback: has("cache") ? "A cache reduces load on the data store." : "Nothing caches hot data yet.",
      suggestions: [!has("cache") && "Add a cache for hot reads and state the eviction and invalidation policy.", !has("edge") && "Serve static content from a CDN."].filter(Boolean) as string[],
    },
    {
      id: "tradeoffs",
      name: "Requirements & trade-offs",
      score: tradeoffs,
      feedback: progress.total === 0 ? "No checklist." : `${progress.done}/${progress.total} checklist items completed.`,
      suggestions: progress.done < progress.total ? ["Finish the checklist: requirements, scale numbers and SLAs justify every box you drew."] : [],
    },
  ];

  const score = overallScore(categories);
  const weakest = [...categories].sort((a, b) => a.score - b.score)[0];
  return {
    source: "heuristic",
    score,
    summary: `Structural check: ${score}/100. The weakest area is ${weakest.name.toLowerCase()}. This is a fast check of the diagram's shape; run the AI review for a written critique.`,
    categories,
    strengths: strengths.slice(0, 5),
    gaps: REVIEW_CATEGORIES.flatMap((c) => gapsBy[c.id]).slice(0, 6),
    createdAt: now,
  };
}

/* ------------------------------------------------------------------ AI prompt */

export interface ReviewInput {
  /** The board in Slate's diagram DSL. */
  dsl: string;
  checklist: { section: string; item: string; done: boolean; note: string }[];
  /** What the candidate wrote in the document pane. */
  notes?: string;
}

export function flattenChecklist(sections: ChecklistSection[]): ReviewInput["checklist"] {
  return sections.flatMap((s) => s.items.map((i) => ({ section: s.title, item: i.text, done: i.done, note: i.note })));
}

export function reviewSystemPrompt(): string {
  return `You are a principal engineer grading a system design interview answer. You are given the candidate's architecture diagram (in a compact text form), their requirement checklist and, optionally, their written notes. Grade it honestly and specifically: name components from the diagram, never give generic advice.

Reply with ONE JSON object and nothing else (no prose, no markdown fences):
{
  "score": number 0-100,
  "summary": string (2-3 sentences, plain language),
  "categories": [
    { "id": "scalability" | "availability" | "data" | "caching" | "tradeoffs", "score": number 0-10, "feedback": string, "suggestions": [string, ...] }
  ],
  "strengths": [string, ...],
  "gaps": [string, ...]
}

Rubric (include all five categories, in this order):
- scalability: load balancing, horizontal scaling, async processing, back-pressure
- availability: single points of failure, replication, failover, multi-AZ, graceful degradation
- data: choice of store, schema fit, replication, sharding / partitioning strategy, consistency
- caching: what is cached, where (CDN, app, DB), invalidation, hot keys
- tradeoffs: requirements gathered, back-of-envelope numbers, SLAs, trade-offs stated and justified

Keep each feedback under 60 words, give at most 3 suggestions per category, at most 4 strengths and 4 gaps.`;
}

export function reviewUserPrompt(input: ReviewInput): string {
  const list = input.checklist.map((c) => `- [${c.done ? "x" : " "}] ${c.section}: ${c.item}${c.note ? ` -> ${c.note}` : ""}`).join("\n");
  return `DIAGRAM\n${input.dsl.trim() || "(empty)"}\n\nCHECKLIST\n${list || "(none)"}\n\nCANDIDATE NOTES\n${input.notes?.trim() || "(none)"}`;
}
