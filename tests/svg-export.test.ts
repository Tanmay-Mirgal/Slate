import { describe, expect, it } from "vitest";
import { cardSize, createCard, createConnector, createShape, DEFAULT_STYLE } from "@/lib/canvas/create";
import { Engine } from "@/lib/canvas/engine";
import { exportSvg } from "@/lib/canvas/export";
import type { El } from "@/lib/canvas/types";

/** Every start tag's attribute names, so a duplicate (invalid XML, the image fails to load) is caught without a DOM. */
function duplicateAttributes(svg: string): string[] {
  const dupes: string[] = [];
  for (const tag of svg.match(/<[a-zA-Z][^<>]*>/g) ?? []) {
    const names = Array.from(tag.matchAll(/\s([a-zA-Z:-]+)=(?:"[^"]*"|'[^']*')/g)).map((m) => m[1]);
    for (const name of new Set(names)) if (names.filter((x) => x === name).length > 1) dupes.push(`${name} in ${tag.slice(0, 80)}`);
  }
  return dupes;
}

const OPTS = { scale: 1, padding: 10, transparent: false, selectionOnly: false, branding: false };

function boardWith(dash: "solid" | "dashed" | "dotted"): Engine {
  const engine = new Engine();
  const a = createCard({ x: 0, y: 0, ...cardSize("A", "", true) }, 1, { title: "A" });
  const b = createCard({ x: 300, y: 0, ...cardSize("B", "", true) }, 2, { title: "B" });
  const edge = { ...createConnector({ x: 0, y: 0 }, { x: 300, y: 0 }, DEFAULT_STYLE, 3, { start: { id: a.id }, end: { id: b.id } }), dash } as El;
  const box = { ...createShape("rect", { x: 0, y: 200, w: 100, h: 60 }, DEFAULT_STYLE, 4), dash } as El;
  engine.store.load([a, b, edge, box]);
  return engine;
}

describe("SVG export", () => {
  for (const dash of ["solid", "dashed", "dotted"] as const) {
    it(`emits well-formed attributes for ${dash} strokes`, () => {
      const svg = exportSvg(boardWith(dash), OPTS)!;
      expect(svg).toContain("<svg");
      expect(duplicateAttributes(svg)).toEqual([]);
    });
  }

  it("keeps round caps on dotted connectors (the dots rely on them)", () => {
    const svg = exportSvg(boardWith("dotted"), OPTS)!;
    const path = svg.match(/<path[^>]*stroke-dasharray="0\.01[^>]*>/)?.[0] ?? "";
    expect(path.match(/stroke-linecap="round"/g)).toHaveLength(1);
  });

  it("returns null for an empty board", () => {
    expect(exportSvg(new Engine(), OPTS)).toBeNull();
  });
});
