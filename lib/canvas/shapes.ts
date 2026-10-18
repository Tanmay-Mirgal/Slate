import type { Point, Rect, ShapeKind, Side } from "./types";

/**
 * Shape geometry as SVG path strings in the shape's local frame (0..w, 0..h).
 * The same strings feed Path2D on the canvas, hit-testing and SVG export, so
 * there is exactly one source of truth for what a shape looks like.
 */

export interface ShapePaths {
  /** Closed outline used for fill + stroke. */
  d: string;
  /** Extra decoration stroked on top (e.g. the front rim of a cylinder). */
  detail?: string;
}

const f = (n: number) => +n.toFixed(2);

export function roundedRectPath(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return `M0 0H${f(w)}V${f(h)}H0Z`;
  return (
    `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}` +
    `V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}` +
    `H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}` +
    `V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`
  );
}

function starPoints(w: number, h: number): Point[] {
  const cx = w / 2;
  const cy = h / 2;
  const pts: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push({ x: cx + Math.cos(a) * (w / 2) * r, y: cy + Math.sin(a) * (h / 2) * r });
  }
  return pts;
}

export function shapePaths(kind: ShapeKind, w: number, h: number, radius = 12): ShapePaths {
  w = Math.max(1, Math.abs(w));
  h = Math.max(1, Math.abs(h));
  switch (kind) {
    case "rect":
      return { d: roundedRectPath(w, h, radius) };
    case "stadium":
      return { d: roundedRectPath(w, h, Math.min(w, h) / 2) };
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      return { d: `M0 ${f(ry)}A${f(rx)} ${f(ry)} 0 1 1 ${f(w)} ${f(ry)}A${f(rx)} ${f(ry)} 0 1 1 0 ${f(ry)}Z` };
    }
    case "diamond":
      return { d: `M${f(w / 2)} 0L${f(w)} ${f(h / 2)}L${f(w / 2)} ${f(h)}L0 ${f(h / 2)}Z` };
    case "triangle":
      return { d: `M${f(w / 2)} 0L${f(w)} ${f(h)}L0 ${f(h)}Z` };
    case "hexagon": {
      const inset = Math.min(w * 0.25, h * 0.5);
      return {
        d: `M${f(inset)} 0H${f(w - inset)}L${f(w)} ${f(h / 2)}L${f(w - inset)} ${f(h)}H${f(inset)}L0 ${f(h / 2)}Z`,
      };
    }
    case "parallelogram": {
      const skew = Math.min(w * 0.22, h * 0.6);
      return { d: `M${f(skew)} 0H${f(w)}L${f(w - skew)} ${f(h)}H0Z` };
    }
    case "cylinder": {
      const ry = Math.min(h * 0.16, w * 0.3, 28);
      const rx = w / 2;
      return {
        d:
          `M0 ${f(ry)}A${f(rx)} ${f(ry)} 0 0 1 ${f(w)} ${f(ry)}V${f(h - ry)}` +
          `A${f(rx)} ${f(ry)} 0 0 1 0 ${f(h - ry)}Z`,
        detail: `M0 ${f(ry)}A${f(rx)} ${f(ry)} 0 0 0 ${f(w)} ${f(ry)}`,
      };
    }
    case "cloud": {
      const p = (x: number, y: number) => `${f(x * w)} ${f(y * h)}`;
      return {
        d:
          `M${p(0.24, 0.84)}` +
          `C${p(0.1, 0.84)} ${p(0.01, 0.72)} ${p(0.01, 0.58)}` +
          `C${p(0.01, 0.44)} ${p(0.1, 0.35)} ${p(0.22, 0.36)}` +
          `C${p(0.22, 0.18)} ${p(0.36, 0.06)} ${p(0.5, 0.08)}` +
          `C${p(0.6, 0.0)} ${p(0.8, 0.06)} ${p(0.82, 0.3)}` +
          `C${p(0.94, 0.3)} ${p(0.99, 0.42)} ${p(0.99, 0.58)}` +
          `C${p(0.99, 0.74)} ${p(0.9, 0.84)} ${p(0.78, 0.84)}Z`,
      };
    }
    case "document": {
      const p = (x: number, y: number) => `${f(x * w)} ${f(y * h)}`;
      return {
        d: `M0 0H${f(w)}V${f(h * 0.86)}C${p(0.78, 0.74)} ${p(0.62, 0.74)} ${p(0.5, 0.86)}C${p(0.36, 0.99)} ${p(0.2, 0.99)} ${p(0, 0.86)}Z`,
      };
    }
    case "star": {
      const pts = starPoints(w, h);
      return { d: "M" + pts.map((q) => `${f(q.x)} ${f(q.y)}`).join("L") + "Z" };
    }
  }
}

/** Polygon approximation of the outline in local coordinates; null for ellipse-like shapes. */
export function shapePolygon(kind: ShapeKind, w: number, h: number): Point[] | null {
  switch (kind) {
    case "diamond":
      return [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }];
    case "triangle":
      return [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    case "hexagon": {
      const inset = Math.min(w * 0.25, h * 0.5);
      return [
        { x: inset, y: 0 },
        { x: w - inset, y: 0 },
        { x: w, y: h / 2 },
        { x: w - inset, y: h },
        { x: inset, y: h },
        { x: 0, y: h / 2 },
      ];
    }
    case "parallelogram": {
      const skew = Math.min(w * 0.22, h * 0.6);
      return [{ x: skew, y: 0 }, { x: w, y: 0 }, { x: w - skew, y: h }, { x: 0, y: h }];
    }
    case "star":
      return starPoints(w, h);
    case "ellipse":
      return null;
    default:
      return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  }
}

/** The region text should occupy inside a shape (local coordinates). */
export function textBox(kind: ShapeKind, w: number, h: number): Rect {
  const pad = 10;
  const box = (ix: number, iy: number, ox = ix, oy = iy): Rect => ({
    x: ix,
    y: iy,
    w: Math.max(8, w - ix - ox),
    h: Math.max(8, h - iy - oy),
  });
  switch (kind) {
    case "ellipse":
      return box(w * 0.14 + 2, h * 0.14 + 2);
    case "diamond":
      return box(w * 0.25, h * 0.25);
    case "triangle":
      return { x: w * 0.25, y: h * 0.38, w: w * 0.5, h: h * 0.52 };
    case "hexagon":
      return box(Math.min(w * 0.25, h * 0.5) * 0.7 + 4, pad / 2);
    case "parallelogram":
      return box(Math.min(w * 0.22, h * 0.6) + 4, pad / 2);
    case "cylinder": {
      const ry = Math.min(h * 0.16, w * 0.3, 28);
      return { x: pad, y: ry * 1.5, w: Math.max(8, w - pad * 2), h: Math.max(8, h - ry * 2.5) };
    }
    case "cloud":
      return { x: w * 0.12, y: h * 0.28, w: w * 0.76, h: h * 0.5 };
    case "document":
      return { x: pad, y: pad / 2, w: Math.max(8, w - pad * 2), h: Math.max(8, h * 0.74 - pad / 2) };
    case "star":
      return { x: w * 0.28, y: h * 0.32, w: w * 0.44, h: h * 0.36 };
    default:
      return box(pad, pad / 2);
  }
}

/**
 * Where a connector attaches on `side` at fraction `t` along the bounding box side,
 * pulled onto the shape's actual outline so arrows never end in empty space.
 */
export function anchorOnShape(kind: ShapeKind | null, w: number, h: number, side: Side, t = 0.5): Point {
  const tt = Math.min(1, Math.max(0, t));
  const plain = (): Point => {
    switch (side) {
      case "top":
        return { x: w * tt, y: 0 };
      case "bottom":
        return { x: w * tt, y: h };
      case "left":
        return { x: 0, y: h * tt };
      case "right":
        return { x: w, y: h * tt };
    }
  };
  if (!kind) return plain();
  switch (kind) {
    case "triangle":
      if (side === "left") return { x: w * 0.25, y: h * 0.5 };
      if (side === "right") return { x: w * 0.75, y: h * 0.5 };
      return side === "top" ? { x: w / 2, y: 0 } : { x: w * tt, y: h };
    case "parallelogram": {
      const skew = Math.min(w * 0.22, h * 0.6);
      if (side === "left") return { x: skew * (1 - tt), y: h * tt };
      if (side === "right") return { x: w - skew * tt, y: h * (1 - tt) };
      return plain();
    }
    case "diamond":
    case "ellipse":
    case "star":
      switch (side) {
        case "top":
          return { x: w / 2, y: 0 };
        case "bottom":
          return { x: w / 2, y: h };
        case "left":
          return { x: 0, y: h / 2 };
        case "right":
          return { x: w, y: h / 2 };
      }
      return plain();
    case "stadium":
    case "hexagon":
    case "cloud":
      if (side === "left" || side === "right") return { x: side === "left" ? 0 : w, y: h / 2 };
      return { x: w * Math.min(0.85, Math.max(0.15, tt)), y: side === "top" ? 0 : h };
    default:
      return plain();
  }
}

/** Shapes whose outline is not a plain box: connector anchors snap to the centre of each side. */
export function isBoxLike(kind: ShapeKind): boolean {
  return kind === "rect" || kind === "document" || kind === "cylinder";
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  hexagon: "Hexagon",
  parallelogram: "Parallelogram",
  cylinder: "Cylinder",
  cloud: "Cloud",
  stadium: "Terminator",
  document: "Document",
  star: "Star",
};

export const SHAPE_KINDS = Object.keys(SHAPE_LABELS) as ShapeKind[];

/* ------------------------------------------------------------- Path2D cache */

const path2dCache = new Map<string, Path2D>();

export function cachedPath2D(d: string): Path2D {
  let p = path2dCache.get(d);
  if (!p) {
    if (path2dCache.size > 3000) path2dCache.clear();
    p = new Path2D(d);
    path2dCache.set(d, p);
  }
  return p;
}
