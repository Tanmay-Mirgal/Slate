import { describe, expect, it } from "vitest";
import {
  AUTO_INTERVAL_MS,
  buildSnapshot,
  chunkString,
  cleanLabel,
  contentHash,
  joinChunks,
  MAX_AUTO_VERSIONS,
  parseSnapshot,
  pruneAuto,
  shouldAutoSnapshot,
} from "@/lib/canvas/version-snapshot";

const row = (eid: string, z: number, extra: object = {}) => ({ eid, z, data: JSON.stringify({ id: "stale", type: "shape", shape: "rect", x: 1, y: 2, w: 3, h: 4, z: 99, ...extra }) });

describe("snapshot chunks", () => {
  it("round-trips any text exactly", () => {
    const text = "héllo wörld ✓ ".repeat(5000);
    for (const size of [7, 100, 4096, 200_000]) expect(joinChunks(chunkString(text, size))).toBe(text);
    expect(chunkString("")).toEqual([""]);
  });

  it("never splits a surrogate pair across chunks (it would not survive UTF-8 storage)", () => {
    const text = "😀".repeat(200); // every emoji is two UTF-16 code units
    for (const size of [3, 5, 7, 99]) {
      const chunks = chunkString(text, size);
      expect(joinChunks(chunks)).toBe(text);
      for (const c of chunks) {
        // a lone surrogate would be replaced by U+FFFD when encoded
        expect(new TextDecoder().decode(new TextEncoder().encode(c))).toBe(c);
        expect(c.length).toBeLessThanOrEqual(size + 1);
      }
    }
  });

  it("cuts a big board into only a few chunks", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row(`e${i}`, i, { text: "x".repeat(60) }));
    const { json } = buildSnapshot(rows);
    expect(chunkString(json).length).toBeLessThan(10);
  });
});

describe("buildSnapshot / parseSnapshot", () => {
  it("takes id and z from the row, orders by paint order and skips corrupt rows", () => {
    const built = buildSnapshot([row("b", 2), row("a", 1), { eid: "bad", z: 3, data: "{not json" }, { eid: "arr", z: 4, data: "[1,2]" }, row("c", 1)]);
    expect(built.skipped).toBe(2);
    expect(built.count).toBe(3);
    const els = parseSnapshot(chunkString(built.json, 50)) as { id: string; z: number }[];
    expect(els.map((e) => e.id)).toEqual(["a", "c", "b"]); // z asc, then id
    expect(els.map((e) => e.z)).toEqual([1, 1, 2]);
  });

  it("rejects a payload that is not an array", () => {
    expect(() => parseSnapshot(['{"a":1}'])).toThrow(/damaged/);
    expect(() => parseSnapshot(["nope"])).toThrow();
  });

  it("an empty board is a valid snapshot", () => {
    const built = buildSnapshot([]);
    expect(built.json).toBe("[]");
    expect(parseSnapshot([built.json])).toEqual([]);
  });
});

describe("contentHash", () => {
  it("is stable and changes with the content", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
    expect(contentHash("")).not.toBe(contentHash(" "));
  });
});

describe("version policy", () => {
  it("auto snapshots wait one interval from the last one (or from the board's creation)", () => {
    const base = { createdAt: 1_000_000, intervalMs: AUTO_INTERVAL_MS };
    expect(shouldAutoSnapshot({ ...base, now: 1_000_000 + 1000, lastAutoAt: undefined })).toBe(false);
    expect(shouldAutoSnapshot({ ...base, now: 1_000_000 + AUTO_INTERVAL_MS, lastAutoAt: undefined })).toBe(true);
    expect(shouldAutoSnapshot({ ...base, now: 5_000_000, lastAutoAt: 5_000_000 - AUTO_INTERVAL_MS + 1 })).toBe(false);
    expect(shouldAutoSnapshot({ ...base, now: 5_000_000, lastAutoAt: 5_000_000 - AUTO_INTERVAL_MS })).toBe(true);
  });

  it("prunes only automatic versions, oldest first", () => {
    const list = [
      ...Array.from({ length: MAX_AUTO_VERSIONS + 3 }, (_, i) => ({ id: `auto${i}`, kind: "auto" as const, createdAt: i })),
      { id: "named", kind: "manual" as const, createdAt: -5 },
    ];
    const doomed = pruneAuto(list);
    expect(doomed).toEqual(["auto2", "auto1", "auto0"].sort((a, b) => list.find((x) => x.id === b)!.createdAt - list.find((x) => x.id === a)!.createdAt));
    expect(doomed).not.toContain("named");
    expect(pruneAuto(list.slice(0, 5))).toEqual([]);
  });

  it("cleans labels", () => {
    expect(cleanLabel("  Before   the  launch \n")).toBe("Before the launch");
    expect(cleanLabel("   ")).toBeUndefined();
    expect(cleanLabel(undefined)).toBeUndefined();
    expect(cleanLabel("x".repeat(200))!.length).toBe(80);
  });
});
