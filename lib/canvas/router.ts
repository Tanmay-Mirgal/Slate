import { anchorOnShape, isBoxLike } from "./shapes";
import {
  boxBounds,
  centerOf,
  clamp,
  dist,
  pointAtFraction,
  rotatePoint,
  toLocal,
  unionRects,
} from "./geometry";
import type { Binding, ConnectorEl, El, Point, Rect, Side } from "./types";

/* ---------------------------------------------------------------- primitives */

export type Vec = Point;

const DIRS: Record<Side, Vec> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function sideVector(side: Side): Vec {
  return DIRS[side];
}

function snapAxis(v: Vec): Vec {
  return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x) || 1, y: 0 } : { x: 0, y: Math.sign(v.y) || 1 };
}

export interface RouteScene {
  get(id: string): El | undefined;
  /** Rectangles of node-like elements that intersect `near` (frames and connectors excluded). */
  obstacles(near: Rect): Rect[];
}

export function elementRect(el: El): Rect {
  return boxBounds(el);
}

/** World position of the connection point on `side` of `el`. */
export function anchorFor(el: El, side: Side, t = 0.5): Point {
  const kind = el.type === "shape" ? el.shape : null;
  const tt = kind && !isBoxLike(kind) ? 0.5 : t;
  const local = anchorOnShape(kind, el.w, el.h, side, tt);
  const p = { x: el.x + local.x, y: el.y + local.y };
  return el.angle ? rotatePoint(p, { x: el.x + el.w / 2, y: el.y + el.h / 2 }, el.angle) : p;
}

/** Outward normal of `side`, accounting for the element's rotation (snapped to an axis). */
export function outwardDir(el: El, side: Side): Vec {
  const v = DIRS[side];
  if (!el.angle) return v;
  return snapAxis(rotatePoint(v, { x: 0, y: 0 }, el.angle));
}

/** Which side of `el` faces `toward`. */
export function facingSide(el: El, toward: Point): Side {
  const local = toLocal(el, toward);
  const dx = (local.x - el.w / 2) / Math.max(1, el.w / 2);
  const dy = (local.y - el.h / 2) / Math.max(1, el.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

export interface End {
  p: Point;
  dir: Vec | null;
  side?: Side;
}

function resolveEnd(el: El | undefined, binding: Binding | undefined, free: Point, toward: Point): End {
  if (!el || !binding) return { p: free, dir: null };
  const side = binding.side ?? facingSide(el, toward);
  return { p: anchorFor(el, side, binding.t), dir: outwardDir(el, side), side };
}

export function routeSignature(a: Point, b: Point, route: string): string {
  const r = (n: number) => Math.round(n * 2) / 2;
  return `${r(a.x)},${r(a.y)}>${r(b.x)},${r(b.y)}:${route}`;
}

/* --------------------------------------------------------------------- output */

export interface ConnectorGeom {
  pts: Point[];
  /** SVG path data (rounded corners / curves) in world coordinates. */
  path: string;
  /** Direction of travel leaving the start (pointing away from the start node). */
  startAngle: number;
  /** Direction of travel entering the end. */
  endAngle: number;
  bounds: Rect;
  label: { p: Point; angle: number };
  start: Point;
  end: Point;
}

const f = (n: number) => +n.toFixed(2);

export function roundedPolylinePath(pts: Point[], radius = 10): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}`;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const l1 = dist(prev, cur);
    const l2 = dist(cur, next);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 1) {
      d += `L${f(cur.x)} ${f(cur.y)}`;
      continue;
    }
    const a = { x: cur.x + ((prev.x - cur.x) / l1) * r, y: cur.y + ((prev.y - cur.y) / l1) * r };
    const b = { x: cur.x + ((next.x - cur.x) / l2) * r, y: cur.y + ((next.y - cur.y) / l2) * r };
    d += `L${f(a.x)} ${f(a.y)}Q${f(cur.x)} ${f(cur.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const last = pts[pts.length - 1];
  d += `L${f(last.x)} ${f(last.y)}`;
  return d;
}

function bezierPoints(p0: Point, c1: Point, c2: Point, p1: Point, steps = 28): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

/* ------------------------------------------------------------ orthogonal A* */

const STUB = 22;
const MARGIN = 14;
const BEND_COST = 48;
const MAX_GRID = 26000;

class MinHeap {
  private a: { k: number; v: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: number) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { k: number; v: number } | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function dirIndex(v: Vec): number {
  if (v.x > 0) return 1;
  if (v.x < 0) return 3;
  if (v.y > 0) return 2;
  return 0;
}
const DV: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function uniqueSorted(values: number[]): number[] {
  const s = Array.from(new Set(values.map((v) => Math.round(v * 2) / 2))).sort((a, b) => a - b);
  return s;
}

function addChannels(vals: number[]): number[] {
  const out = vals.slice();
  for (let i = 0; i < vals.length - 1; i++) {
    if (vals[i + 1] - vals[i] >= 28) out.push((vals[i] + vals[i + 1]) / 2);
  }
  return uniqueSorted(out);
}

function insideStrict(x: number, y: number, r: Rect) {
  return x > r.x + 0.01 && x < r.x + r.w - 0.01 && y > r.y + 0.01 && y < r.y + r.h - 0.01;
}

export function simpleElbow(s: Point, sd: Vec | null, e: Point, ed: Vec | null): Point[] {
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const sHoriz = sd ? sd.x !== 0 : Math.abs(dx) >= Math.abs(dy);
  const eHoriz = ed ? ed.x !== 0 : sHoriz;
  let pts: Point[];
  if (sHoriz && eHoriz) {
    const mx = s.x + dx / 2;
    pts = [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e];
  } else if (!sHoriz && !eHoriz) {
    const my = s.y + dy / 2;
    pts = [s, { x: s.x, y: my }, { x: e.x, y: my }, e];
  } else if (sHoriz) {
    pts = [s, { x: e.x, y: s.y }, e];
  } else {
    pts = [s, { x: s.x, y: e.y }, e];
  }
  return compress(pts);
}

export function compress(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  // remove collinear points
  const res: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = res[res.length - 1];
    const b = out[i];
    const c = out[i + 1];
    if (a && c) {
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cross) < 0.01 && dot > 0) continue;
    }
    res.push(b);
  }
  return res;
}

/**
 * Orthogonal route from `s` (leaving along `sd`) to `e` (arriving against `ed`) that
 * avoids `obstacles`. Falls back to a simple elbow if no clean path exists.
 */
export function routeOrthogonal(s: Point, sd: Vec | null, e: Point, ed: Vec | null, obstacles: Rect[]): Point[] {
  const s1 = sd ? { x: s.x + sd.x * STUB, y: s.y + sd.y * STUB } : s;
  const e1 = ed ? { x: e.x + ed.x * STUB, y: e.y + ed.y * STUB } : e;

  const inflated = obstacles
    .map((o) => ({ x: o.x - MARGIN, y: o.y - MARGIN, w: o.w + MARGIN * 2, h: o.h + MARGIN * 2 }))
    .filter((o) => !insideStrict(s1.x, s1.y, o) && !insideStrict(e1.x, e1.y, o));

  // Whole path is always: s -> s1 (stub) -> middle -> e1 (stub) -> e. Duplicate points collapse in compress().
  const fallback = () => compress([s, s1, ...simpleElbow(s1, sd, e1, ed), e1, e]);

  if (inflated.length === 0) return fallback();

  // A bounded window keeps the grid small on huge boards.
  const window = {
    x: Math.min(s1.x, e1.x) - 240,
    y: Math.min(s1.y, e1.y) - 240,
    w: Math.abs(s1.x - e1.x) + 480,
    h: Math.abs(s1.y - e1.y) + 480,
  };
  const near = inflated
    .filter((o) => !(o.x > window.x + window.w || o.x + o.w < window.x || o.y > window.y + window.h || o.y + o.h < window.y))
    .slice(0, 60);

  const xsRaw = [s1.x, e1.x, (s1.x + e1.x) / 2];
  const ysRaw = [s1.y, e1.y, (s1.y + e1.y) / 2];
  for (const o of near) {
    xsRaw.push(o.x, o.x + o.w);
    ysRaw.push(o.y, o.y + o.h);
  }
  const xs = addChannels(uniqueSorted(xsRaw));
  const ys = addChannels(uniqueSorted(ysRaw));
  if (xs.length * ys.length > MAX_GRID) return fallback();

  const W = xs.length;
  const H = ys.length;
  const ix = (x: number) => xs.indexOf(Math.round(x * 2) / 2);
  const iy = (y: number) => ys.indexOf(Math.round(y * 2) / 2);
  const si = ix(s1.x);
  const sj = iy(s1.y);
  const ei = ix(e1.x);
  const ej = iy(e1.y);
  if (si < 0 || sj < 0 || ei < 0 || ej < 0) return fallback();

  // Blocked edges: midpoint of each unit step must not be inside an obstacle.
  const blockedH = new Uint8Array(W * H); // step (i,j) -> (i+1,j)
  const blockedV = new Uint8Array(W * H); // step (i,j) -> (i,j+1)
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (i + 1 < W) {
        const mx = (xs[i] + xs[i + 1]) / 2;
        for (const o of near) {
          if (insideStrict(mx, ys[j], o)) {
            blockedH[j * W + i] = 1;
            break;
          }
        }
      }
      if (j + 1 < H) {
        const my = (ys[j] + ys[j + 1]) / 2;
        for (const o of near) {
          if (insideStrict(xs[i], my, o)) {
            blockedV[j * W + i] = 1;
            break;
          }
        }
      }
    }
  }
  const nodeBlocked = (i: number, j: number) => {
    for (const o of near) if (insideStrict(xs[i], ys[j], o)) return true;
    return false;
  };

  const startDir = sd ? dirIndex(sd) : Math.abs(e1.x - s1.x) >= Math.abs(e1.y - s1.y) ? (e1.x >= s1.x ? 1 : 3) : e1.y >= s1.y ? 2 : 0;
  const wantArrive = ed ? dirIndex({ x: -ed.x, y: -ed.y }) : -1;

  const stateCount = W * H * 4;
  const gScore = new Float64Array(stateCount).fill(Infinity);
  const from = new Int32Array(stateCount).fill(-1);
  const heap = new MinHeap();
  const idx = (i: number, j: number, d: number) => (j * W + i) * 4 + d;
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ei]) + Math.abs(ys[j] - ys[ej]);

  const startState = idx(si, sj, startDir);
  gScore[startState] = 0;
  heap.push(h(si, sj), startState);

  let goalState = -1;
  while (heap.size) {
    const cur = heap.pop()!;
    const state = cur.v;
    const d = state & 3;
    const cell = state >> 2;
    const i = cell % W;
    const j = (cell - i) / W;
    const g = gScore[state];
    if (cur.k - h(i, j) > g + 1e-6) continue; // stale entry
    if (i === ei && j === ej) {
      goalState = state;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === d) continue; // no U-turns
      const ni = i + DV[nd].x;
      const nj = j + DV[nd].y;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      // edge blocked?
      let blocked = false;
      if (nd === 1) blocked = blockedH[j * W + i] === 1;
      else if (nd === 3) blocked = blockedH[j * W + (i - 1)] === 1;
      else if (nd === 2) blocked = blockedV[j * W + i] === 1;
      else blocked = blockedV[(j - 1) * W + i] === 1;
      if (blocked) continue;
      if (nodeBlocked(ni, nj) && !(ni === ei && nj === ej)) continue;
      const step = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      let cost = g + step + (nd !== d ? BEND_COST : 0);
      if (ni === ei && nj === ej && wantArrive >= 0 && nd !== wantArrive) cost += BEND_COST;
      const ns = idx(ni, nj, nd);
      if (cost < gScore[ns]) {
        gScore[ns] = cost;
        from[ns] = state;
        heap.push(cost + h(ni, nj), ns);
      }
    }
  }

  if (goalState < 0) return fallback();

  const grid: Point[] = [];
  for (let s = goalState; s >= 0; s = from[s]) {
    const cell = s >> 2;
    const i = cell % W;
    const j = (cell - i) / W;
    grid.push({ x: xs[i], y: ys[j] });
  }
  grid.reverse();
  return compress([s, s1, ...grid, e1, e]);
}

/* --------------------------------------------------------------- resolution */

function boundsOfPoints(pts: Point[], pad = 0): Rect {
  const r = unionRects(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

function finish(pts: Point[], path: string, c: ConnectorEl): ConnectorGeom {
  const n = pts.length;
  const startAngle = n >= 2 ? Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x) : 0;
  const endAngle = n >= 2 ? Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x) : 0;
  return {
    pts,
    path,
    startAngle,
    endAngle,
    bounds: boundsOfPoints(pts, (c.strokeWidth ?? 2) + 8),
    label: pointAtFraction(pts, c.labelT ?? 0.5),
    start: pts[0],
    end: pts[n - 1],
  };
}

export function resolveConnector(c: ConnectorEl, scene: RouteScene): ConnectorGeom {
  const startEl = c.start ? scene.get(c.start.id) : undefined;
  const endEl = c.end ? scene.get(c.end.id) : undefined;
  const freeStart = c.points[0] ?? { x: c.x, y: c.y };
  const freeEnd = c.points[c.points.length - 1] ?? { x: c.x + c.w, y: c.y + c.h };

  const startBound = !!(startEl && c.start);
  const endBound = !!(endEl && c.end);

  // Self loop
  if (startBound && endBound && startEl!.id === endEl!.id && c.route !== "straight") {
    const el = startEl!;
    const s = anchorFor(el, c.start!.side ?? "right", c.start!.t);
    const e = anchorFor(el, c.end!.side ?? "bottom", c.end!.t);
    const out = 34;
    const pts = compress([
      s,
      { x: s.x + out, y: s.y },
      { x: s.x + out, y: e.y + out },
      { x: e.x, y: e.y + out },
      e,
    ]);
    return finish(pts, roundedPolylinePath(pts, 10), c);
  }

  const startCenter = startEl ? centerOf(elementRect(startEl)) : freeStart;
  const endCenter = endEl ? centerOf(elementRect(endEl)) : freeEnd;

  const a = resolveEnd(startEl, startBound ? c.start : undefined, freeStart, endBound ? endCenter : freeEnd);
  const b = resolveEnd(endEl, endBound ? c.end : undefined, freeEnd, startBound ? startCenter : freeStart);

  // Cached route (AI / DSL layouts) is valid while both endpoints are where they were when it was saved.
  if (c.points.length >= 2 && c.routeSig && c.routeSig === routeSignature(a.p, b.p, c.route)) {
    const pts = c.points;
    const path = c.route === "curve" ? curvePathThrough(pts) : roundedPolylinePath(pts, c.route === "elbow" ? 10 : 0);
    return finish(pts, path, c);
  }

  if (c.route === "straight") {
    // Free polylines keep their interior vertices; bound connectors are a single segment.
    const interior = !startBound && !endBound && c.points.length > 2 ? c.points.slice(1, -1) : [];
    const pts = [a.p, ...interior, b.p];
    return finish(pts, roundedPolylinePath(pts, 0), c);
  }

  if (c.route === "curve") {
    const sd = a.dir ?? autoDir(a.p, b.p);
    const ed = b.dir ?? { x: -autoDir(a.p, b.p).x, y: -autoDir(a.p, b.p).y };
    const k = clamp(dist(a.p, b.p) * 0.45, 36, 180);
    const c1 = { x: a.p.x + sd.x * k, y: a.p.y + sd.y * k };
    const c2 = { x: b.p.x + ed.x * k, y: b.p.y + ed.y * k };
    const pts = bezierPoints(a.p, c1, c2, b.p);
    const path = `M${f(a.p.x)} ${f(a.p.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.p.x)} ${f(b.p.y)}`;
    return finish(pts, path, c);
  }

  // elbow
  const near: Rect = {
    x: Math.min(a.p.x, b.p.x) - 260,
    y: Math.min(a.p.y, b.p.y) - 260,
    w: Math.abs(a.p.x - b.p.x) + 520,
    h: Math.abs(a.p.y - b.p.y) + 520,
  };
  const pts = routeOrthogonal(a.p, a.dir, b.p, b.dir, scene.obstacles(near));
  return finish(pts, roundedPolylinePath(pts, 10), c);
}

function autoDir(a: Point, b: Point): Vec {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: Math.sign(b.x - a.x) || 1, y: 0 } : { x: 0, y: Math.sign(b.y - a.y) || 1 };
}

/** Smooth Catmull-Rom style path through arbitrary points. */
export function curvePathThrough(pts: Point[]): string {
  if (pts.length < 3) return roundedPolylinePath(pts, 0);
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** Simple scene over a plain array, handy for tests and the server-side layout. */
export function sceneFromElements(els: El[]): RouteScene {
  const map = new Map(els.map((e) => [e.id, e]));
  return {
    get: (id) => map.get(id),
    obstacles: (near) =>
      els
        .filter((e) => e.type !== "connector" && e.type !== "frame" && e.type !== "pen")
        .map(elementRect)
        .filter((r) => !(r.x > near.x + near.w || r.x + r.w < near.x || r.y > near.y + near.h || r.y + r.h < near.y)),
  };
}
