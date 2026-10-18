import { describe, expect, it } from "vitest";
import { boardStats } from "@/lib/canvas/stats";
import { cardSize, createCard, createConnector, createFrame, createShape, createSticky, DEFAULT_STYLE } from "@/lib/canvas/create";

describe("boardStats", () => {
  it("counts diagram nodes and connectors, not frames or labels", () => {
    const a = createCard({ x: 0, y: 0, ...cardSize("A", "", true) }, 1, { title: "A" });
    const b = createCard({ x: 300, y: 0, ...cardSize("B", "", true) }, 2, { title: "B" });
    const shape = createShape("rect", { x: 0, y: 200, w: 100, h: 60 }, DEFAULT_STYLE, 3);
    const note = createSticky({ x: 400, y: 200, w: 120, h: 120 }, DEFAULT_STYLE, 4);
    const frame = createFrame({ x: -40, y: -40, w: 800, h: 500 }, 0, "Prod");
    const edge = createConnector({ x: 0, y: 0 }, { x: 300, y: 0 }, DEFAULT_STYLE, 5, { start: { id: a.id }, end: { id: b.id } });
    expect(boardStats([a, b, shape, note, frame, edge])).toEqual({ nodes: 4, connectors: 1 });
    expect(boardStats([])).toEqual({ nodes: 0, connectors: 0 });
  });
});
