import { icons as lucideIcons } from "lucide";
import brandPaths from "./brand-icons.json";
import { findIconDef, serviceIcon } from "./icons-catalog";

/**
 * Icon rendering. Every glyph is reduced to a single SVG path string in a 24x24
 * box, drawn either stroked (Lucide, 2px round) or filled (brand logos).
 */

export interface Glyph {
  /** SVG path data in a 24x24 viewBox. */
  d: string;
  mode: "stroke" | "fill";
  /** Natural colour of the glyph when it has one (brand logos, cloud services). */
  color?: string;
}

type LucideNode = [string, Record<string, string>][];

const num = (v: string | undefined, d = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};

export function lucideNodeToPath(node: LucideNode): string {
  const out: string[] = [];
  for (const [tag, a] of node) {
    switch (tag) {
      case "path":
        if (a.d) out.push(a.d);
        break;
      case "circle": {
        const cx = num(a.cx);
        const cy = num(a.cy);
        const r = num(a.r);
        out.push(`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`);
        break;
      }
      case "ellipse": {
        const cx = num(a.cx);
        const cy = num(a.cy);
        const rx = num(a.rx);
        const ry = num(a.ry);
        out.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`);
        break;
      }
      case "rect": {
        const x = num(a.x);
        const y = num(a.y);
        const w = num(a.width);
        const h = num(a.height);
        const rx = Math.min(num(a.rx, num(a.ry)), w / 2);
        const ry = Math.min(num(a.ry, rx), h / 2);
        if (rx > 0 || ry > 0) {
          out.push(
            `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
          );
        } else out.push(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
        break;
      }
      case "line":
        out.push(`M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`);
        break;
      case "polyline":
      case "polygon": {
        const pts = (a.points || "").trim().split(/[\s,]+/).map(Number);
        if (pts.length >= 4) {
          let d = `M${pts[0]} ${pts[1]}`;
          for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
          if (tag === "polygon") d += "Z";
          out.push(d);
        }
        break;
      }
    }
  }
  return out.join("");
}

const glyphCache = new Map<string, Glyph | null>();
const path2dCache = new Map<string, Path2D>();

function lucideGlyph(name: string): Glyph | null {
  const node = (lucideIcons as unknown as Record<string, LucideNode>)[name];
  if (!node) return null;
  return { d: lucideNodeToPath(node), mode: "stroke" };
}

export function getGlyph(key: string | undefined): Glyph | null {
  if (!key) return null;
  if (glyphCache.has(key)) return glyphCache.get(key)!;
  let glyph: Glyph | null = null;
  const [kind, ref] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "lucide") glyph = lucideGlyph(ref);
  else if (kind === "brand") {
    const d = (brandPaths as Record<string, string>)[ref];
    const def = findIconDef(key);
    if (d) glyph = { d, mode: "fill", color: def?.color };
  } else if (kind === "svc") {
    const svc = serviceIcon(key);
    if (svc) {
      const g = lucideGlyph(svc.lucide);
      if (g) glyph = { ...g, color: svc.color };
    }
  }
  glyphCache.set(key, glyph);
  return glyph;
}

export function iconExists(key: string): boolean {
  return getGlyph(key) !== null;
}

export function glyphPath2D(glyph: Glyph): Path2D {
  let p = path2dCache.get(glyph.d);
  if (!p) {
    p = new Path2D(glyph.d);
    path2dCache.set(glyph.d, p);
  }
  return p;
}

/** Draws a glyph into the square (x, y, size, size). */
export function drawGlyph(ctx: CanvasRenderingContext2D, key: string | undefined, x: number, y: number, size: number, color: string) {
  const glyph = getGlyph(key) || getGlyph("lucide:Box");
  if (!glyph) return;
  const path = glyphPath2D(glyph);
  ctx.save();
  ctx.translate(x, y);
  const s = size / 24;
  ctx.scale(s, s);
  if (glyph.mode === "stroke") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
  } else {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.restore();
}

/** Markup for a glyph inside an <svg viewBox="0 0 24 24"> (picker + SVG export). */
export function glyphSvgAttrs(glyph: Glyph, color: string): { fill: string; stroke: string; strokeWidth?: number } {
  return glyph.mode === "stroke"
    ? { fill: "none", stroke: color, strokeWidth: 2 }
    : { fill: color, stroke: "none" };
}

export function allLucideNames(): string[] {
  return Object.keys(lucideIcons);
}

/** Display name for an icon key (used for labels when dropped on the board). */
export function iconLabel(key: string): string {
  const def = findIconDef(key);
  if (def) return def.label;
  const ref = key.slice(key.indexOf(":") + 1);
  return ref.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
