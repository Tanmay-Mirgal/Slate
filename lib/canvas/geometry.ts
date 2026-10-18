import type { Point, Rect } from "./types";

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, step = 1) => Math.round(v / step) * step;
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function centerOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** Strict overlap (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function rotatePoint(p: Point, c: Point, angle: number): Point {
  if (!angle) return p;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

export function boxCorners(b: Box): [Point, Point, Point, Point] {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const a = b.angle || 0;
  return [
    rotatePoint({ x: b.x, y: b.y }, c, a),
    rotatePoint({ x: b.x + b.w, y: b.y }, c, a),
    rotatePoint({ x: b.x + b.w, y: b.y + b.h }, c, a),
    rotatePoint({ x: b.x, y: b.y + b.h }, c, a),
  ];
}

/** Axis aligned bounds of a possibly rotated box. */
export function boxBounds(b: Box): Rect {
  if (!b.angle) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const pts = boxCorners(b);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Maps a world point into the box's unrotated local frame (origin at top-left). */
export function toLocal(b: Box, p: Point): Point {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const q = rotatePoint(p, c, -(b.angle || 0));
  return { x: q.x - b.x, y: q.y - b.y };
}

export function fromLocal(b: Box, p: Point): Point {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return rotatePoint({ x: b.x + p.x, y: b.y + p.y }, c, b.angle || 0);
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  if (pts.length === 1) best = dist(p, pts[0]);
  return best;
}

export function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += dist(pts[i], pts[i + 1]);
  return len;
}

/** Point at fraction `t` (0..1) of the polyline's length, plus the local tangent angle. */
export function pointAtFraction(pts: Point[], t: number): { p: Point; angle: number } {
  if (pts.length === 0) return { p: { x: 0, y: 0 }, angle: 0 };
  if (pts.length === 1) return { p: pts[0], angle: 0 };
  const total = polylineLength(pts);
  let target = clamp(t, 0, 1) * total;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = dist(pts[i], pts[i + 1]);
    if (target <= seg || i === pts.length - 2) {
      const f = seg === 0 ? 0 : clamp(target / seg, 0, 1);
      return {
        p: { x: lerp(pts[i].x, pts[i + 1].x, f), y: lerp(pts[i].y, pts[i + 1].y, f) },
        angle: Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x),
      };
    }
    target -= seg;
  }
  const last = pts[pts.length - 1];
  return { p: last, angle: 0 };
}

/** Fraction (0..1) along the polyline of the point closest to `p`. */
export function fractionOfClosest(pts: Point[], p: Point): number {
  const total = polylineLength(pts);
  if (total === 0) return 0.5;
  let best = Infinity;
  let bestAt = 0;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = dist(a, b);
    if (seg > 0) {
      const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (seg * seg), 0, 1);
      const d = Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
      if (d < best) {
        best = d;
        bestAt = acc + t * seg;
      }
    }
    acc += seg;
  }
  return clamp(bestAt / total, 0, 1);
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const br = { x: r.x + r.w, y: r.y + r.h };
  const bl = { x: r.x, y: r.y + r.h };
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}

function ccw(a: Point, b: Point, c: Point) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

/** Ramer–Douglas–Peucker simplification for freehand strokes. */
export function simplifyPolyline(pts: Point[], epsilon: number): Point[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function snapValue(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function angleSnap(angle: number, step = Math.PI / 12): number {
  return Math.round(angle / step) * step;
}

export function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}
