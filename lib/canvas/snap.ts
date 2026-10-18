import type { Guide } from "./render";
import type { Rect } from "./types";

export interface SnapOptions {
  objects: boolean;
  grid: boolean;
  gridSize: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

const lines = (r: Rect, axis: "x" | "y") =>
  axis === "x" ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];

function bestDelta(values: number[], targets: number[], thr: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, target: t };
    }
  }
  return best;
}

/** Snaps a moving rectangle to the edges / centres of `others` (and optionally the grid). */
export function snapMove(moving: Rect, others: Rect[], zoom: number, opts: SnapOptions): SnapResult {
  const thr = 6 / zoom;
  let dx = 0;
  let dy = 0;
  let xTarget: number | null = null;
  let yTarget: number | null = null;

  if (opts.objects && others.length) {
    const xt = others.flatMap((r) => lines(r, "x"));
    const yt = others.flatMap((r) => lines(r, "y"));
    const bx = bestDelta(lines(moving, "x"), xt, thr);
    const by = bestDelta(lines(moving, "y"), yt, thr);
    if (bx) {
      dx = bx.delta;
      xTarget = bx.target;
    }
    if (by) {
      dy = by.delta;
      yTarget = by.target;
    }
  }
  if (opts.grid) {
    if (xTarget === null) dx = Math.round(moving.x / opts.gridSize) * opts.gridSize - moving.x;
    if (yTarget === null) dy = Math.round(moving.y / opts.gridSize) * opts.gridSize - moving.y;
  }

  const guides: Guide[] = [];
  const snapped: Rect = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h };
  if (xTarget !== null) {
    let from = snapped.y;
    let to = snapped.y + snapped.h;
    for (const o of others) {
      if (lines(o, "x").some((v) => Math.abs(v - xTarget!) < 0.5)) {
        from = Math.min(from, o.y);
        to = Math.max(to, o.y + o.h);
      }
    }
    guides.push({ axis: "x", pos: xTarget, from, to });
  }
  if (yTarget !== null) {
    let from = snapped.x;
    let to = snapped.x + snapped.w;
    for (const o of others) {
      if (lines(o, "y").some((v) => Math.abs(v - yTarget!) < 0.5)) {
        from = Math.min(from, o.x);
        to = Math.max(to, o.x + o.w);
      }
    }
    guides.push({ axis: "y", pos: yTarget, from, to });
  }
  return { dx, dy, guides };
}

/**
 * Snaps individual edge coordinates (used while resizing). `xs` / `ys` are the world positions
 * of the edges that are currently moving.
 */
export function snapEdges(
  xs: number[],
  ys: number[],
  bounds: Rect,
  others: Rect[],
  zoom: number,
  opts: SnapOptions
): SnapResult {
  const thr = 6 / zoom;
  let dx = 0;
  let dy = 0;
  let xTarget: number | null = null;
  let yTarget: number | null = null;
  if (opts.objects && others.length) {
    const bx = xs.length ? bestDelta(xs, others.flatMap((r) => lines(r, "x")), thr) : null;
    const by = ys.length ? bestDelta(ys, others.flatMap((r) => lines(r, "y")), thr) : null;
    if (bx) {
      dx = bx.delta;
      xTarget = bx.target;
    }
    if (by) {
      dy = by.delta;
      yTarget = by.target;
    }
  }
  if (opts.grid) {
    if (xTarget === null && xs.length) dx = Math.round(xs[0] / opts.gridSize) * opts.gridSize - xs[0];
    if (yTarget === null && ys.length) dy = Math.round(ys[0] / opts.gridSize) * opts.gridSize - ys[0];
  }
  const guides: Guide[] = [];
  if (xTarget !== null) guides.push({ axis: "x", pos: xTarget, from: bounds.y - 20, to: bounds.y + bounds.h + 20 });
  if (yTarget !== null) guides.push({ axis: "y", pos: yTarget, from: bounds.x - 20, to: bounds.x + bounds.w + 20 });
  return { dx, dy, guides };
}
