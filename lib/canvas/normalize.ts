import type {
  ArrowHead,
  Binding,
  Dash,
  El,
  FontFamily,
  Point,
  Route,
  ShapeKind,
  Side,
  TableColumn,
  TextAlign,
} from "./types";
import { SHAPE_KINDS } from "./shapes";

/**
 * Validates and sanitises an element coming from storage / the network / a paste.
 * Unknown fields are dropped, numbers are clamped, collections are capped. Returns
 * null for anything that cannot be rendered, so one corrupt row never breaks a board.
 */

const MAX_COORD = 1e7;
const MAX_TEXT = 20000;
const MAX_POINTS = 4000;

const num = (v: unknown, d: number, min = -MAX_COORD, max = MAX_COORD): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const oneOf = <T extends string>(v: unknown, set: readonly T[]): T | undefined =>
  typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

const SIDES = ["top", "right", "bottom", "left"] as const;
const DASHES = ["solid", "dashed", "dotted"] as const;
const ALIGNS = ["left", "center", "right"] as const;
const FONTS = ["sans", "mono", "hand", "serif"] as const;
const HEADS = ["none", "arrow", "triangle", "diamond", "dot", "bar"] as const;
const ROUTES = ["straight", "elbow", "curve"] as const;

function binding(v: unknown): Binding | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  const id = str(b.id, 80);
  if (!id) return undefined;
  const out: Binding = { id };
  const side = oneOf<Side>(b.side, SIDES);
  if (side) out.side = side;
  if (typeof b.t === "number" && Number.isFinite(b.t)) out.t = Math.min(1, Math.max(0, b.t));
  return out;
}

function points(v: unknown): Point[] {
  if (!Array.isArray(v)) return [];
  const out: Point[] = [];
  for (const p of v.slice(0, MAX_POINTS)) {
    if (p && typeof p === "object") {
      const q = p as Record<string, unknown>;
      if (typeof q.x === "number" && typeof q.y === "number" && Number.isFinite(q.x) && Number.isFinite(q.y)) {
        out.push({ x: Math.min(MAX_COORD, Math.max(-MAX_COORD, q.x)), y: Math.min(MAX_COORD, Math.max(-MAX_COORD, q.y)) });
      }
    }
  }
  return out;
}

function columns(v: unknown): TableColumn[] {
  if (!Array.isArray(v)) return [];
  const out: TableColumn[] = [];
  for (const c of v.slice(0, 60)) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const name = str(r.name, 80);
    if (!name) continue;
    const col: TableColumn = { name };
    const type = str(r.type, 40);
    if (type) col.type = type;
    const key = oneOf(r.key, ["pk", "fk", "unique"] as const);
    if (key) col.key = key;
    out.push(col);
  }
  return out;
}

export function normalizeElement(raw: unknown): El | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const type = r.type;
  if (!id || typeof type !== "string") return null;

  const base = {
    id,
    x: num(r.x, 0),
    y: num(r.y, 0),
    w: num(r.w, 0, 0, MAX_COORD),
    h: num(r.h, 0, 0, MAX_COORD),
    z: num(r.z, 0),
    ...(typeof r.angle === "number" && Number.isFinite(r.angle) && r.angle !== 0 ? { angle: r.angle } : {}),
    ...(str(r.groupId, 80) ? { groupId: str(r.groupId, 80) } : {}),
    ...(bool(r.locked) ? { locked: true } : {}),
    ...(typeof r.opacity === "number" && r.opacity < 1 ? { opacity: num(r.opacity, 1, 0, 1) } : {}),
    ...(str(r.stroke, 80) ? { stroke: str(r.stroke, 80) } : {}),
    ...(str(r.fill, 80) ? { fill: str(r.fill, 80) } : {}),
    ...(typeof r.strokeWidth === "number" ? { strokeWidth: num(r.strokeWidth, 2, 0, 40) } : {}),
    ...(oneOf<Dash>(r.dash, DASHES) ? { dash: oneOf<Dash>(r.dash, DASHES) } : {}),
    ...(str(r.diagramId, 80) ? { diagramId: str(r.diagramId, 80) } : {}),
  };

  const textStyle = () => ({
    ...(typeof r.fontSize === "number" ? { fontSize: num(r.fontSize, 16, 6, 400) } : {}),
    ...(oneOf<FontFamily>(r.font, FONTS) ? { font: oneOf<FontFamily>(r.font, FONTS) } : {}),
    ...(oneOf<TextAlign>(r.align, ALIGNS) ? { align: oneOf<TextAlign>(r.align, ALIGNS) } : {}),
    ...(bool(r.bold) ? { bold: true } : {}),
    ...(bool(r.italic) ? { italic: true } : {}),
  });

  switch (type) {
    case "shape": {
      const shape = oneOf<ShapeKind>(r.shape, SHAPE_KINDS) ?? "rect";
      return {
        ...base,
        type: "shape",
        shape,
        ...(typeof r.radius === "number" ? { radius: num(r.radius, 12, 0, 500) } : {}),
        ...(str(r.text) !== undefined ? { text: str(r.text) } : {}),
        ...(str(r.icon, 80) ? { icon: str(r.icon, 80) } : {}),
        ...(str(r.color, 80) ? { color: str(r.color, 80) } : {}),
        ...textStyle(),
      } as El;
    }
    case "text":
      return {
        ...base,
        type: "text",
        text: str(r.text) ?? "",
        fontSize: num(r.fontSize, 20, 6, 400),
        font: oneOf<FontFamily>(r.font, FONTS) ?? "sans",
        align: oneOf<TextAlign>(r.align, ALIGNS) ?? "left",
        ...(bool(r.bold) ? { bold: true } : {}),
        ...(bool(r.italic) ? { italic: true } : {}),
        ...(bool(r.autoW) ? { autoW: true } : {}),
      };
    case "sticky":
      return {
        ...base,
        type: "sticky",
        text: str(r.text) ?? "",
        ...(typeof r.fontSize === "number" ? { fontSize: num(r.fontSize, 18, 6, 200) } : {}),
        ...(oneOf<FontFamily>(r.font, FONTS) ? { font: oneOf<FontFamily>(r.font, FONTS) } : {}),
      };
    case "frame":
      return {
        ...base,
        type: "frame",
        title: str(r.title, 200) ?? "",
        ...(str(r.accent, 80) ? { accent: str(r.accent, 80) } : {}),
      };
    case "card":
      return {
        ...base,
        type: "card",
        title: str(r.title, 400) ?? "",
        ...(str(r.subtitle, 600) ? { subtitle: str(r.subtitle, 600) } : {}),
        ...(str(r.icon, 80) ? { icon: str(r.icon, 80) } : {}),
        ...(str(r.accent, 80) ? { accent: str(r.accent, 80) } : {}),
      };
    case "icon":
      return {
        ...base,
        type: "icon",
        icon: str(r.icon, 80) ?? "lucide:Box",
        ...(str(r.label, 200) ? { label: str(r.label, 200) } : {}),
        ...(str(r.accent, 80) ? { accent: str(r.accent, 80) } : {}),
      };
    case "table":
      return {
        ...base,
        type: "table",
        title: str(r.title, 200) ?? "",
        columns: columns(r.columns),
        ...(str(r.accent, 80) ? { accent: str(r.accent, 80) } : {}),
      };
    case "connector": {
      const pts = points(r.points);
      return {
        ...base,
        type: "connector",
        points: pts,
        ...(binding(r.start) ? { start: binding(r.start) } : {}),
        ...(binding(r.end) ? { end: binding(r.end) } : {}),
        route: oneOf<Route>(r.route, ROUTES) ?? "elbow",
        startHead: oneOf<ArrowHead>(r.startHead, HEADS) ?? "none",
        endHead: oneOf<ArrowHead>(r.endHead, HEADS) ?? "arrow",
        ...(str(r.label, 600) ? { label: str(r.label, 600) } : {}),
        ...(typeof r.labelT === "number" ? { labelT: num(r.labelT, 0.5, 0, 1) } : {}),
        ...(str(r.routeSig, 200) ? { routeSig: str(r.routeSig, 200) } : {}),
        ...(typeof r.fontSize === "number" ? { fontSize: num(r.fontSize, 12, 6, 100) } : {}),
      };
    }
    case "pen": {
      const raw = Array.isArray(r.pts) ? r.pts.slice(0, MAX_POINTS * 2) : [];
      const pts = raw.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      if (pts.length < 2) return null;
      return { ...base, type: "pen", pts, ...(bool(r.highlighter) ? { highlighter: true } : {}) };
    }
    case "image": {
      const src = str(r.src, 3_000_000);
      if (!src) return null;
      return { ...base, type: "image", src, ...(str(r.alt, 300) ? { alt: str(r.alt, 300) } : {}) };
    }
    default:
      return null;
  }
}

export function normalizeMany(list: unknown): El[] {
  if (!Array.isArray(list)) return [];
  const out: El[] = [];
  for (const raw of list) {
    const el = normalizeElement(raw);
    if (el) out.push(el);
  }
  return out;
}
