import { describe, expect, it } from "vitest";
import { cameraAfterResize, clampSplit, parseSplit, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, splitFromPointer } from "@/lib/canvas/split";
import { countWords, statsFor } from "@/components/editor/doc-bridge";

describe("split ratio", () => {
  it("clamps to 20..80 and rejects non-numbers", () => {
    expect(clampSplit(5)).toBe(SPLIT_MIN);
    expect(clampSplit(95)).toBe(SPLIT_MAX);
    expect(clampSplit(42.5)).toBe(42.5);
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(SPLIT_DEFAULT);
  });

  it("parses stored values defensively", () => {
    expect(parseSplit(null)).toBe(SPLIT_DEFAULT);
    expect(parseSplit("")).toBe(SPLIT_DEFAULT);
    expect(parseSplit("garbage")).toBe(SPLIT_DEFAULT);
    expect(parseSplit("33.3")).toBe(33.3);
    expect(parseSplit("1")).toBe(SPLIT_MIN);
    expect(parseSplit("999")).toBe(SPLIT_MAX);
  });

  it("maps a pointer position inside the container to a clamped percentage", () => {
    expect(splitFromPointer(300, 100, 1000)).toBe(20);
    expect(splitFromPointer(600, 100, 1000)).toBe(50);
    expect(splitFromPointer(0, 100, 1000)).toBe(SPLIT_MIN);
    expect(splitFromPointer(5000, 100, 1000)).toBe(SPLIT_MAX);
    expect(splitFromPointer(600, 100, 0)).toBe(SPLIT_DEFAULT);
  });
});

describe("camera anchoring on pane resize", () => {
  const cam = { x: 100, y: 40, zoom: 2 };

  it("start anchor leaves the camera alone", () => {
    expect(cameraAfterResize(cam, { w: 800, h: 600 }, { w: 400, h: 600 }, "start")).toEqual(cam);
  });

  it("center anchor keeps the world point at the viewport centre fixed", () => {
    const from = { w: 800, h: 600 };
    const to = { w: 400, h: 500 };
    const next = cameraAfterResize(cam, from, to, "center");
    const centreWorld = (c: typeof cam, s: { w: number; h: number }) => ({ x: (s.w / 2 - c.x) / c.zoom, y: (s.h / 2 - c.y) / c.zoom });
    expect(centreWorld(next, to)).toEqual(centreWorld(cam, from));
    expect(next.zoom).toBe(cam.zoom);
  });

  it("ignores the very first measurement, when there was no previous size", () => {
    expect(cameraAfterResize(cam, { w: 0, h: 0 }, { w: 800, h: 600 }, "center")).toEqual(cam);
  });
});

describe("document stats", () => {
  it("counts words and estimates reading time", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  hello   brave new\nworld ")).toBe(4);
    expect(statsFor(0, true, true).minutes).toBe(0);
    expect(statsFor(10, true, true).minutes).toBe(1);
    expect(statsFor(1100, true, true).minutes).toBe(5);
  });
});
