import { describe, expect, it } from "vitest";
import { resolveConnector, routeOrthogonal, sceneFromElements, simpleElbow } from "@/lib/canvas/router";
import { segmentIntersectsRect } from "@/lib/canvas/geometry";
import type { ConnectorEl, El, Rect, ShapeEl } from "@/lib/canvas/types";

const box = (id: string, x: number, y: number, w = 120, h = 60): ShapeEl => ({
  id,
  type: "shape",
  shape: "rect",
  x,
  y,
  w,
  h,
  z: 0,
});

const connector = (id: string, from: string, to: string, route: ConnectorEl["route"] = "elbow"): ConnectorEl => ({
  id,
  type: "connector",
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  z: 1,
  points: [],
  start: { id: from },
  end: { id: to },
  route,
  startHead: "none",
  endHead: "arrow",
});

const axisAligned = (pts: { x: number; y: number }[]) =>
  pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01);

function crossesAny(pts: { x: number; y: number }[], rects: Rect[]) {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const r of rects) {
      const inner = { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 };
      if (segmentIntersectsRect(pts[i], pts[i + 1], inner)) return true;
    }
  }
  return false;
}

describe("orthogonal router", () => {
  it("produces axis aligned paths between two boxes", () => {
    const a = box("a", 0, 0);
    const b = box("b", 400, 220);
    const geom = resolveConnector(connector("c", "a", "b"), sceneFromElements([a, b]));
    expect(axisAligned(geom.pts)).toBe(true);
    expect(geom.pts.length).toBeGreaterThanOrEqual(2);
  });

  it("routes around an obstacle sitting on the straight line", () => {
    const a = box("a", 0, 100);
    const b = box("b", 500, 100);
    const wall = box("w", 230, 40, 40, 180);
    const els: El[] = [a, b, wall];
    const geom = resolveConnector(connector("c", "a", "b"), sceneFromElements(els));
    expect(axisAligned(geom.pts)).toBe(true);
    expect(crossesAny(geom.pts, [{ x: wall.x, y: wall.y, w: wall.w, h: wall.h }])).toBe(false);
  });

  it("does not cut through its own endpoints when the target is behind the source", () => {
    const a = box("a", 400, 0);
    const b = box("b", 0, 0);
    const els: El[] = [a, b];
    const geom = resolveConnector(connector("c", "a", "b"), sceneFromElements(els));
    expect(axisAligned(geom.pts)).toBe(true);
    const rects = els.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
    expect(crossesAny(geom.pts, rects)).toBe(false);
  });

  it("falls back to a simple elbow with no obstacles", () => {
    const pts = routeOrthogonal({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 200, y: 100 }, { x: -1, y: 0 }, []);
    expect(axisAligned(pts)).toBe(true);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it("simpleElbow collapses collinear points", () => {
    const pts = simpleElbow({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, { x: -1, y: 0 });
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("curve connectors end exactly on their anchors", () => {
    const a = box("a", 0, 0);
    const b = box("b", 400, 0);
    const geom = resolveConnector(connector("c", "a", "b", "curve"), sceneFromElements([a, b]));
    expect(geom.start).toEqual({ x: 120, y: 30 });
    expect(geom.end).toEqual({ x: 400, y: 30 });
  });

  it("uses cached waypoints while endpoints are unchanged and recomputes after a move", () => {
    const a = box("a", 0, 0);
    const b = box("b", 400, 0);
    const base = resolveConnector(connector("c", "a", "b"), sceneFromElements([a, b]));
    const cached: ConnectorEl = {
      ...connector("c", "a", "b"),
      points: [{ x: 120, y: 30 }, { x: 260, y: 30 }, { x: 260, y: -80 }, { x: 400, y: -80 }, { x: 400, y: 30 }],
      routeSig: `120,30>400,30:elbow`,
    };
    const hit = resolveConnector(cached, sceneFromElements([a, b]));
    expect(hit.pts).toEqual(cached.points);
    const moved = resolveConnector(cached, sceneFromElements([a, box("b", 400, 300)]));
    expect(moved.pts).not.toEqual(cached.points);
    expect(base.pts.length).toBeGreaterThan(1);
  });
});
