import { describe, expect, it } from "vitest";
import { cardSize, createCard, createConnector, DEFAULT_STYLE } from "@/lib/canvas/create";
import type { El } from "@/lib/canvas/types";
import { heuristicReview, normalizeReview, overallScore, reviewUserPrompt, flattenChecklist } from "@/lib/interview/review";
import { DEFAULT_SCALE, compact, defaultSections, estimateScale, parseSections, progressOf } from "@/lib/interview/rubric";
import { InterviewStore, defaultInterviewState, parseInterviewState } from "@/lib/interview/store";
import { INTERVIEW_DURATION_MS, createTimer, formatClock, parseTimer, pauseTimer, phaseOf, remaining, resetTimer, startTimer, urgency } from "@/lib/interview/timer";

let z = 1;
const card = (title: string, subtitle = "", icon = ""): El => createCard({ x: 0, y: 0, ...cardSize(title, subtitle, true) }, z++, { title, subtitle, icon: icon || undefined });
const link = (a: El, b: El): El => createConnector({ x: 0, y: 0 }, { x: 10, y: 10 }, DEFAULT_STYLE, z++, { start: { id: a.id }, end: { id: b.id } });

describe("interview timer", () => {
  const T0 = 1_000_000;

  it("counts down from 45 minutes using the clock", () => {
    const t = createTimer();
    expect(t.durationMs).toBe(INTERVIEW_DURATION_MS);
    expect(remaining(t, T0)).toBe(INTERVIEW_DURATION_MS);
    const running = startTimer(t, T0);
    expect(remaining(running, T0 + 60_000)).toBe(INTERVIEW_DURATION_MS - 60_000);
    expect(phaseOf(running, T0 + 1)).toBe("running");
  });

  it("pauses without losing time and resumes from there", () => {
    const paused = pauseTimer(startTimer(createTimer(), T0), T0 + 10 * 60_000);
    expect(paused.startedAt).toBeNull();
    expect(remaining(paused, T0 + 99 * 60_000)).toBe(35 * 60_000);
    expect(phaseOf(paused, T0 + 99 * 60_000)).toBe("paused");
    const resumed = startTimer(paused, T0 + 20 * 60_000);
    expect(remaining(resumed, T0 + 25 * 60_000)).toBe(30 * 60_000);
  });

  it("ends at zero and cannot restart until reset", () => {
    const running = startTimer(createTimer(), T0);
    const after = T0 + INTERVIEW_DURATION_MS + 5000;
    expect(remaining(running, after)).toBe(0);
    expect(phaseOf(running, after)).toBe("over");
    const frozen = pauseTimer(running, after);
    expect(startTimer(frozen, after)).toBe(frozen);
    expect(remaining(resetTimer(frozen), after)).toBe(INTERVIEW_DURATION_MS);
    expect(phaseOf(resetTimer(frozen), after)).toBe("idle");
  });

  it("formats the clock and picks an urgency band", () => {
    expect(formatClock(INTERVIEW_DURATION_MS)).toBe("45:00");
    expect(formatClock(59_001)).toBe("01:00");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(urgency(30 * 60_000)).toBe("calm");
    expect(urgency(9 * 60_000)).toBe("warning");
    expect(urgency(2 * 60_000)).toBe("critical");
  });

  it("restores a saved timer and rejects garbage", () => {
    expect(parseTimer(null)).toEqual(createTimer());
    expect(parseTimer({ durationMs: "x", remainingMs: -4, startedAt: "no" }).startedAt).toBeNull();
    const saved = parseTimer({ durationMs: INTERVIEW_DURATION_MS, remainingMs: 600_000, startedAt: T0 });
    expect(saved).toEqual({ durationMs: INTERVIEW_DURATION_MS, remainingMs: 600_000, startedAt: T0 });
    expect(parseTimer({ durationMs: 1000, remainingMs: 5, startedAt: null }).durationMs).toBe(INTERVIEW_DURATION_MS);
  });
});

describe("scale calculator", () => {
  it("turns users into traffic and storage", () => {
    const e = estimateScale({ dau: 8_640_000, actionsPerUser: 10, readPct: 90, payloadKb: 1, retentionYears: 2, peakFactor: 3 });
    expect(e.avgQps).toBeCloseTo(1000, 5);
    expect(e.readQps).toBeCloseTo(900, 5);
    expect(e.writeQps).toBeCloseTo(100, 5);
    expect(e.peakQps).toBeCloseTo(3000, 5);
    expect(e.storageGbPerYear).toBeCloseTo((100 * 86400 * 365) / 1024 / 1024, 3);
    expect(e.totalStorageTb).toBeCloseTo((e.storageGbPerYear * 2) / 1024, 6);
  });

  it("clamps nonsense instead of returning NaN", () => {
    const e = estimateScale({ ...DEFAULT_SCALE, dau: Number.NaN, readPct: 500, peakFactor: -2 });
    for (const v of Object.values(e)) expect(Number.isFinite(v)).toBe(true);
  });

  it("formats big numbers compactly", () => {
    expect(compact(100)).toBe("100");
    expect(compact(12_345)).toBe("12.3K");
    expect(compact(1_200_000)).toBe("1.2M");
    expect(compact(2_500_000_000)).toBe("2.5B");
    expect(compact(0)).toBe("0");
  });
});

describe("checklist", () => {
  it("ships five sections with trackable progress", () => {
    const s = defaultSections();
    expect(s.map((x) => x.id)).toEqual(["functional", "scale", "sla", "data", "deepdive"]);
    expect(progressOf(s)).toEqual({ done: 0, total: 15 });
    s[0].items[0].done = true;
    expect(progressOf(s).done).toBe(1);
  });

  it("restores saved progress and tolerates damage", () => {
    const saved = defaultSections();
    saved[1].items[0].done = true;
    saved[1].items[0].note = "10M DAU";
    const restored = parseSections(JSON.parse(JSON.stringify(saved)));
    expect(restored[1].items[0]).toMatchObject({ done: true, note: "10M DAU" });
    expect(parseSections("nope")).toEqual(defaultSections());
    expect(parseSections([{ id: "scale", items: [{ id: 1 }, null, { id: "a", text: "  " }] }])[1].items).toEqual(defaultSections()[1].items);
  });
});

describe("heuristic architecture review", () => {
  it("asks for more before reviewing a near-empty board", () => {
    const r = heuristicReview([card("Only one")], defaultSections());
    expect(r.score).toBe(0);
    expect(r.summary).toMatch(/isn't enough/);
  });

  it("rewards a layered, replicated design more than a bare chain", () => {
    const bare = [card("Web client"), card("API"), card("PostgreSQL", "", "brand:postgresql")];
    const bareReview = heuristicReview([...bare, link(bare[0], bare[1]), link(bare[1], bare[2])], defaultSections());

    const client = card("Web client");
    const cdn = card("CDN", "", "svc:aws-cloudfront");
    const lb = card("Load balancer", "", "svc:aws-elb");
    const api = card("API x3");
    const cache = card("Redis", "", "brand:redis");
    const q = card("Kafka", "", "brand:apachekafka");
    const db = card("PostgreSQL", "primary + replica", "brand:postgresql");
    const good = [client, cdn, lb, api, cache, q, db, link(client, cdn), link(cdn, lb), link(lb, api), link(api, cache), link(api, q), link(api, db)];
    const goodReview = heuristicReview(good, defaultSections());

    expect(goodReview.score).toBeGreaterThan(bareReview.score);
    expect(goodReview.categories.find((c) => c.id === "caching")!.score).toBeGreaterThanOrEqual(8);
    expect(bareReview.categories.find((c) => c.id === "caching")!.score).toBe(0);
    expect(bareReview.gaps.join(" ")).toMatch(/cache/i);
    expect(goodReview.source).toBe("heuristic");
  });

  it("counts completed checklist items toward the trade-offs score", () => {
    const els = [card("Client"), card("API"), card("DB", "", "brand:postgresql")];
    const wired = [...els, link(els[0], els[1]), link(els[1], els[2])];
    const sections = defaultSections();
    const before = heuristicReview(wired, sections).categories.find((c) => c.id === "tradeoffs")!.score;
    for (const s of sections) for (const i of s.items) i.done = true;
    const after = heuristicReview(wired, sections).categories.find((c) => c.id === "tradeoffs")!.score;
    expect(before).toBe(0);
    expect(after).toBe(10);
  });
});

describe("AI review parsing", () => {
  it("normalises a model reply into the rubric shape", () => {
    const r = normalizeReview(
      {
        score: 71.6,
        summary: "  Solid start.  ",
        categories: [
          { id: "scalability", score: 8, feedback: "Good", suggestions: ["Add autoscaling"] },
          { id: "availability", score: 4, feedback: "Single DB" },
          { name: "Data & sharding", score: 6 },
          { id: "caching", score: 12, feedback: "x".repeat(900) },
        ],
        strengths: ["a", "b"],
        weaknesses: ["no replica"],
      },
      "model-x",
      42
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBe(72);
    expect(r!.summary).toBe("Solid start.");
    expect(r!.categories.map((c) => c.id)).toEqual(["scalability", "availability", "data", "caching", "tradeoffs"]);
    expect(r!.categories.find((c) => c.id === "caching")).toMatchObject({ score: 10 });
    expect(r!.categories.find((c) => c.id === "caching")!.feedback.length).toBeLessThanOrEqual(400);
    expect(r!.gaps).toEqual(["no replica"]);
    expect(r).toMatchObject({ source: "ai", model: "model-x", createdAt: 42 });
  });

  it("returns null for replies with nothing usable", () => {
    expect(normalizeReview(null)).toBeNull();
    expect(normalizeReview({ foo: 1 })).toBeNull();
    expect(normalizeReview({ categories: [] })).toBeNull();
  });

  it("derives an overall score when the model omits one", () => {
    const r = normalizeReview({ categories: [{ id: "scalability", score: 10 }, { id: "availability", score: 10 }, { id: "data", score: 10 }, { id: "caching", score: 10 }, { id: "tradeoffs", score: 10 }] });
    expect(r!.score).toBe(100);
    expect(overallScore([])).toBe(0);
  });

  it("builds a prompt that carries the diagram, checklist and notes", () => {
    const sections = defaultSections();
    sections[0].items[0].done = true;
    sections[0].items[0].note = "Photo sharing";
    const prompt = reviewUserPrompt({ dsl: "title X", checklist: flattenChecklist(sections), notes: "Use S3" });
    expect(prompt).toContain("title X");
    expect(prompt).toContain("[x] Functional requirements");
    expect(prompt).toContain("Photo sharing");
    expect(prompt).toContain("Use S3");
  });
});

describe("interview state store", () => {
  it("round-trips through JSON and recovers from damage", () => {
    const s = defaultInterviewState();
    s.enabled = true;
    s.sections[0].items[0].done = true;
    s.timer = { durationMs: INTERVIEW_DURATION_MS, remainingMs: 1000, startedAt: null };
    const back = parseInterviewState(JSON.parse(JSON.stringify(s)));
    expect(back.enabled).toBe(true);
    expect(back.sections[0].items[0].done).toBe(true);
    expect(back.timer.remainingMs).toBe(1000);
    expect(parseInterviewState("junk")).toEqual(defaultInterviewState());
    expect(parseInterviewState({ scale: { dau: "lots" } }).scale.dau).toBe(DEFAULT_SCALE.dau);
  });

  it("notifies subscribers and edits the checklist", () => {
    const store = new InterviewStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.toggleItem("functional", "f1");
    expect(store.getState().sections[0].items[0].done).toBe(true);
    store.setNote("functional", "f1", "scope: upload + feed");
    expect(store.getState().sections[0].items[0].note).toBe("scope: upload + feed");
    store.addItem("scale", "  Estimate CDN egress  ");
    store.addItem("scale", "   ");
    expect(store.getState().sections[1].items.at(-1)?.text).toBe("Estimate CDN egress");
    expect(store.getState().sections[1].items).toHaveLength(4);
    store.removeItem("scale", store.getState().sections[1].items.at(-1)!.id);
    expect(store.getState().sections[1].items).toHaveLength(3);
    store.start(1000);
    expect(store.getState().timer.startedAt).toBe(1000);
    store.pause(61_000);
    expect(store.getState().timer.remainingMs).toBe(INTERVIEW_DURATION_MS - 60_000);
    store.reset();
    expect(store.getState().timer.remainingMs).toBe(INTERVIEW_DURATION_MS);
    expect(calls).toBe(7); // the blank addItem is a no-op and emits nothing
  });
});
