import { distToPolyline, distToSegment, pointInPolygon, toLocal } from "./geometry";
import { shapePolygon } from "./shapes";
import type { ConnectorGeom } from "./router";
import type { El, Point, Rect, ShapeEl } from "./types";

export const isTransparent = (c: string | undefined) =>
  !c || c === "transparent" || c === "none" || /^rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /^#[0-9a-f]{6}00$/i.test(c);

function distToPolygonEdge(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** True when clicking inside the element's body (not only on its outline) should hit it. */
function bodyHittable(el: ShapeEl): boolean {
  return !isTransparent(el.fill) || !!el.text || !!el.icon;
}

export interface HitOptions {
  /** World-space tolerance (screen tolerance / zoom). */
  tol: number;
  /** Eraser: transparent shapes are only hit on their outline. */
  outlineOnly?: boolean;
}

export function hitElement(el: El, p: Point, geom: ConnectorGeom | undefined, opts: HitOptions): boolean {
  const { tol } = opts;
  switch (el.type) {
    case "connector": {
      if (!geom) return false;
      const reach = tol + (el.strokeWidth ?? 2) / 2 + 3;
      if (distToPolyline(p, geom.pts) <= reach) return true;
      if (el.label) {
        const lp = geom.label.p;
        const w = Math.min(240, el.label.length * (el.fontSize ?? 12) * 0.6 + 18);
        const h = (el.fontSize ?? 12) * 1.3 + 10;
        return Math.abs(p.x - lp.x) <= w / 2 && Math.abs(p.y - lp.y) <= h / 2;
      }
      return false;
    }
    case "pen": {
      const reach = tol + (el.highlighter ? (el.strokeWidth ?? 3) * 3 : (el.strokeWidth ?? 3) / 2 + 2);
      const lx = p.x - el.x;
      const ly = p.y - el.y;
      const pts = el.pts;
      let best = Infinity;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        best = Math.min(best, distToSegment({ x: lx, y: ly }, { x: pts[i], y: pts[i + 1] }, { x: pts[i + 2], y: pts[i + 3] }));
        if (best <= reach) return true;
      }
      if (pts.length >= 2 && pts.length < 4) return Math.hypot(lx - pts[0], ly - pts[1]) <= reach;
      return false;
    }
    case "frame": {
      const q = toLocal(el, p);
      const inside = q.x >= -tol && q.x <= el.w + tol && q.y >= -tol && q.y <= el.h + tol;
      if (!inside) return false;
      // title band or border only, so the interior stays click-through
      if (q.y <= 38) return true;
      return Math.min(q.x, el.w - q.x, q.y, el.h - q.y) <= tol + 2;
    }
    case "shape": {
      const q = toLocal(el, p);
      const w = el.w;
      const h = el.h;
      const reach = tol + (el.strokeWidth ?? 2) / 2;
      if (q.x < -reach || q.y < -reach || q.x > w + reach || q.y > h + reach) return false;
      const poly = shapePolygon(el.shape, w, h);
      const body = !opts.outlineOnly && bodyHittable(el);
      if (poly) {
        if (body && pointInPolygon(q, poly)) return true;
        return distToPolygonEdge(q, poly) <= reach;
      }
      // ellipse
      const rx = Math.max(1, w / 2);
      const ry = Math.max(1, h / 2);
      const nx = (q.x - rx) / rx;
      const ny = (q.y - ry) / ry;
      const r = Math.hypot(nx, ny);
      if (body && r <= 1) return true;
      return Math.abs(r - 1) * Math.min(rx, ry) <= reach;
    }
    default: {
      // text, sticky, card, icon, table, image: the whole box
      const q = toLocal(el, p);
      const pad = el.type === "text" ? tol + 4 : tol;
      return q.x >= -pad && q.x <= el.w + pad && q.y >= -pad && q.y <= el.h + pad;
    }
  }
}

/** Whether a (possibly rotated) element's bounds intersect a marquee rectangle. */
export function marqueeHits(el: El, marquee: Rect, bounds: Rect): boolean {
  return !(bounds.x > marquee.x + marquee.w || bounds.x + bounds.w < marquee.x || bounds.y > marquee.y + marquee.h || bounds.y + bounds.h < marquee.y);
}
