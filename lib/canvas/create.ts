import { newId } from "./ids";
import { measureBlock, measureWidth, textFont } from "./text";
import { STICKY_COLORS } from "./theme";
import type {
  ArrowHead,
  CardEl,
  ConnectorEl,
  Dash,
  El,
  FontFamily,
  FrameEl,
  IconEl,
  ImageEl,
  PenEl,
  Point,
  Rect,
  Route,
  ShapeEl,
  ShapeKind,
  StickyEl,
  TextAlign,
  TextEl,
} from "./types";

/** Styling the next created element inherits; edited from the properties panel. */
export interface StyleDefaults {
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: Dash;
  opacity: number;
  fontSize: number;
  font: FontFamily;
  align: TextAlign;
  stickyColor: string;
  startHead: ArrowHead;
  endHead: ArrowHead;
  route: Route;
}

export const DEFAULT_STYLE: StyleDefaults = {
  stroke: "ink",
  fill: "transparent",
  strokeWidth: 2,
  dash: "solid",
  opacity: 1,
  fontSize: 18,
  font: "sans",
  align: "center",
  stickyColor: STICKY_COLORS[0],
  startHead: "none",
  endHead: "arrow",
  route: "elbow",
};

export const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  rect: { w: 160, h: 96 },
  ellipse: { w: 150, h: 100 },
  diamond: { w: 150, h: 110 },
  triangle: { w: 130, h: 110 },
  hexagon: { w: 150, h: 100 },
  parallelogram: { w: 170, h: 90 },
  cylinder: { w: 120, h: 130 },
  cloud: { w: 180, h: 120 },
  stadium: { w: 170, h: 70 },
  document: { w: 150, h: 110 },
  star: { w: 130, h: 126 },
  sticky: { w: 200, h: 200 },
  frame: { w: 480, h: 320 },
  card: { w: 200, h: 64 },
  icon: { w: 72, h: 72 },
};

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function createShape(kind: ShapeKind, r: Rect, s: StyleDefaults, z: number): ShapeEl {
  return {
    id: newId("s"),
    type: "shape",
    shape: kind,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    z,
    stroke: s.stroke,
    fill: s.fill,
    strokeWidth: s.strokeWidth,
    ...(s.dash !== "solid" ? { dash: s.dash } : {}),
    ...(s.opacity < 1 ? { opacity: s.opacity } : {}),
    fontSize: s.fontSize,
    font: s.font,
    align: "center",
    ...(kind === "rect" ? { radius: 12 } : {}),
  };
}

export function textSize(text: string, el: Pick<TextEl, "fontSize" | "font" | "bold" | "italic">, maxWidth?: number) {
  const m = measureBlock(text || " ", { size: el.fontSize, family: el.font, bold: el.bold, italic: el.italic }, maxWidth);
  return { w: Math.max(maxWidth ?? 0, Math.ceil(m.w) + 2), h: Math.ceil(m.h) };
}

export function createText(at: Point, s: StyleDefaults, z: number, text = ""): TextEl {
  const base = { fontSize: Math.max(18, s.fontSize), font: s.font, bold: undefined, italic: undefined };
  const size = textSize(text, base);
  return {
    id: newId("t"),
    type: "text",
    x: at.x,
    y: at.y,
    w: Math.max(size.w, 12),
    h: Math.max(size.h, base.fontSize * 1.3),
    z,
    text,
    fontSize: base.fontSize,
    font: s.font,
    align: "left",
    stroke: s.stroke,
    autoW: true,
    ...(s.opacity < 1 ? { opacity: s.opacity } : {}),
  };
}

export function createSticky(r: Rect, s: StyleDefaults, z: number): StickyEl {
  return {
    id: newId("n"),
    type: "sticky",
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    z,
    text: "",
    fill: s.stickyColor,
    fontSize: 20,
    font: "hand",
  };
}

export function createFrame(r: Rect, z: number, title = "Frame"): FrameEl {
  return { id: newId("f"), type: "frame", x: r.x, y: r.y, w: r.w, h: r.h, z, title };
}

/** Natural size of a node card for its text (works on the server via the width estimator). */
export function cardSize(title: string, subtitle?: string, hasIcon = true): { w: number; h: number } {
  const tw = measureWidth(title, textFont({ size: 13.5, bold: true }));
  const sw = subtitle ? measureWidth(subtitle, textFont({ size: 11.5 })) : 0;
  const textW = Math.min(250, Math.max(tw, sw));
  const left = hasIcon ? 12 + 40 + 12 : 14;
  const w = Math.round(Math.max(176, Math.min(340, left + textW + 18)) / 4) * 4;
  const titleLines = tw > w - left - 18 ? 2 : 1;
  const subLines = subtitle ? (sw > w - left - 18 ? 2 : 1) : 0;
  const textH = titleLines * 13.5 * 1.28 + (subLines ? 3 + subLines * 11.5 * 1.3 : 0);
  const h = Math.round(Math.max(hasIcon ? 64 : 52, textH + 26) / 4) * 4;
  return { w, h };
}

export function createCard(r: Rect, z: number, opts: Partial<CardEl> = {}): CardEl {
  return { id: newId("c"), type: "card", x: r.x, y: r.y, w: r.w, h: r.h, z, title: "New node", ...opts };
}

export function createIcon(key: string, r: Rect, z: number, label?: string): IconEl {
  return { id: newId("i"), type: "icon", x: r.x, y: r.y, w: r.w, h: r.h, z, icon: key, ...(label ? { label } : {}) };
}

export function createImage(src: string, r: Rect, z: number): ImageEl {
  return { id: newId("m"), type: "image", x: r.x, y: r.y, w: r.w, h: r.h, z, src };
}

export function createConnector(
  a: Point,
  b: Point,
  s: StyleDefaults,
  z: number,
  overrides: Partial<ConnectorEl> = {}
): ConnectorEl {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    id: newId("e"),
    type: "connector",
    x,
    y,
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
    z,
    points: [a, b],
    route: s.route,
    startHead: s.startHead,
    endHead: s.endHead,
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    ...(s.dash !== "solid" ? { dash: s.dash } : {}),
    ...(s.opacity < 1 ? { opacity: s.opacity } : {}),
    ...overrides,
  };
}

export function createPen(points: Point[], s: StyleDefaults, z: number, highlighter = false): PenEl {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of points) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  const pts: number[] = [];
  for (const p of points) pts.push(+(p.x - x1).toFixed(2), +(p.y - y1).toFixed(2));
  return {
    id: newId("p"),
    type: "pen",
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    z,
    pts,
    stroke: highlighter ? (s.stroke === "ink" ? "#facc15" : s.stroke) : s.stroke,
    strokeWidth: highlighter ? 3 : s.strokeWidth,
    ...(highlighter ? { highlighter: true } : {}),
    ...(s.opacity < 1 ? { opacity: s.opacity } : {}),
  };
}

export function cloneWithNewId<T extends El>(el: T, prefix?: string): T {
  return { ...el, id: newId(prefix ?? el.id.charAt(0)) };
}
