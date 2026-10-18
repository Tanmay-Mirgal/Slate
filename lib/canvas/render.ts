import { getStroke } from "perfect-freehand";
import { boxCorners, clamp, type Box } from "./geometry";
import { handleWorldPoint, visibleHandles } from "./handles";
import { drawGlyph, getGlyph } from "./icons";
import { findIconDef } from "./icons-catalog";
import { getImage } from "./images";
import { anchorFor, type ConnectorGeom } from "./router";
import type { GeometryCache } from "./scene";
import { cachedPath2D, shapePaths, textBox } from "./shapes";
import type { DocStore } from "./store";
import { ellipsize, LINE_HEIGHT, measureWidth, textFont, wrapLines } from "./text";
import { ACCENTS, readableOn, resolveColor, THEMES, withAlpha, type ThemeColors } from "./theme";
import type {
  ArrowHead,
  CardEl,
  Camera,
  ConnectorEl,
  Dash,
  El,
  FrameEl,
  IconEl,
  ImageEl,
  Peer,
  PenEl,
  Point,
  Rect,
  Side,
  ShapeEl,
  StickyEl,
  TableEl,
  TextEl,
  ThemeName,
  ViewSettings,
} from "./types";

export interface Guide {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
}

export interface SelectionBox {
  box: Box;
  /** Show resize handles (false for locked / multi-connector selections). */
  handles: boolean;
  rotatable: boolean;
}

export interface RenderState {
  camera: Camera;
  width: number;
  height: number;
  dpr: number;
  view: ViewSettings;
  selection: ReadonlySet<string>;
  hoverId: string | null;
  editingId: string | null;
  fading: ReadonlySet<string>;
  draft: El | null;
  peers: Peer[];
  marquee: Rect | null;
  guides: Guide[];
  anchorTargets: { id: string; side?: Side }[];
  selectionBox: SelectionBox | null;
  /** Connector endpoint handles for a selected connector. */
  connectorHandles: Point[];
  /** Box of the single selected node that shows the four "+" quick-add handles. */
  quickAdd: Box | null;
  quickAddHover: Side | null;
  anim: ReadonlyMap<string, number>;
  now: number;
  /** false for exports: no background fill, grid or editing chrome. */
  chrome: boolean;
  /** Paint a solid background (export with background). */
  background: boolean;
  /** Rendering for export: disables level-of-detail shortcuts. */
  exporting?: boolean;
  invalidate: () => void;
}

interface Env {
  ctx: CanvasRenderingContext2D;
  theme: ThemeName;
  c: ThemeColors;
  zoom: number;
  /** Zoom used for level-of-detail decisions (always 1 when exporting). */
  lod: number;
  geom: GeometryCache;
  store: DocStore;
  state: RenderState;
}

/* ------------------------------------------------------------------ helpers */

function applyDash(ctx: CanvasRenderingContext2D, dash: Dash | undefined, sw: number) {
  if (dash === "dashed") {
    ctx.setLineDash([sw * 3 + 5, sw * 2 + 4]);
    ctx.lineCap = "butt";
  } else if (dash === "dotted") {
    ctx.setLineDash([0.01, sw * 2 + 4]);
    ctx.lineCap = "round";
  } else {
    ctx.setLineDash([]);
    ctx.lineCap = "round";
  }
}

function withBox(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number; angle?: number }, fn: () => void) {
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
  if (b.angle) ctx.rotate(b.angle);
  ctx.translate(-b.w / 2, -b.h / 2);
  fn();
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/* ------------------------------------------------------------------- grid */

export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number, view: ViewSettings, c: ThemeColors) {
  if (view.grid === "none") return;
  let sp = view.gridSize * camera.zoom;
  let major = 5;
  while (sp < 9) {
    sp *= 2;
    major = 4;
  }
  const ox = ((camera.x % sp) + sp) % sp;
  const oy = ((camera.y % sp) + sp) % sp;
  ctx.save();
  if (view.grid === "dots") {
    ctx.strokeStyle = c.gridStrong;
    ctx.lineWidth = clamp(1.1 + camera.zoom * 0.5, 1.2, 2.2);
    ctx.lineCap = "round";
    ctx.setLineDash([0, sp]);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    for (let y = oy; y < h + sp; y += sp) {
      ctx.moveTo(ox, y);
      ctx.lineTo(w + sp, y);
    }
    ctx.stroke();
  } else {
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    for (let x = ox, i = Math.round((ox - camera.x) / sp); x < w; x += sp, i++) {
      if (i % major === 0) continue;
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = oy, i = Math.round((oy - camera.y) / sp); y < h; y += sp, i++) {
      if (i % major === 0) continue;
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = c.gridStrong;
    ctx.beginPath();
    for (let x = ox, i = Math.round((ox - camera.x) / sp); x < w; x += sp, i++) {
      if (i % major !== 0) continue;
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = oy, i = Math.round((oy - camera.y) / sp); y < h; y += sp, i++) {
      if (i % major !== 0) continue;
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* --------------------------------------------------------------- text util */

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  align: CanvasTextAlign
) {
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  const inset = (lineHeight - parseFloat(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || "14")) / 2;
  for (let i = 0; i < lines.length; i++) if (lines[i]) ctx.fillText(lines[i], x, y + i * lineHeight + inset);
}

function limitLines(lines: string[], max: number, font: string, maxW: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = ellipsize(lines.slice(max - 1).join(" "), font, maxW);
  return kept;
}

/* ------------------------------------------------------------------ shapes */

function drawShape(env: Env, el: ShapeEl) {
  const { ctx, theme } = env;
  const { d, detail } = shapePaths(el.shape, el.w, el.h, el.radius ?? 12);
  const path = cachedPath2D(d);
  withBox(ctx, el, () => {
    const fill = resolveColor(el.fill, theme, "transparent");
    if (fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    const sw = el.strokeWidth ?? 2;
    if (sw > 0) {
      ctx.lineWidth = sw;
      ctx.lineJoin = "round";
      applyDash(ctx, el.dash, sw);
      ctx.strokeStyle = resolveColor(el.stroke, theme, "ink");
      ctx.stroke(path);
      if (detail) ctx.stroke(cachedPath2D(detail));
      ctx.setLineDash([]);
    }
    if (env.state.editingId === el.id) return;
    const hasText = !!el.text;
    if (!hasText && !el.icon) return;
    const box = textBox(el.shape, el.w, el.h);
    const size = el.fontSize ?? 16;
    if (size * env.lod < 3) return;
    const font = textFont({ size, family: el.font ?? "sans", bold: el.bold, italic: el.italic });
    const iconSize = el.icon ? clamp(size * 1.6, 16, 30) : 0;
    const gap = el.icon && hasText ? 8 : 0;
    const textW = Math.max(10, box.w - iconSize - gap);
    const lines = hasText ? wrapLines(el.text!, font, textW) : [];
    const lh = size * LINE_HEIGHT;
    const blockH = lines.length * lh;
    let widest = 0;
    ctx.font = font;
    for (const l of lines) widest = Math.max(widest, measureWidth(l, font));
    const align = el.align ?? "center";
    const groupW = iconSize + gap + Math.min(widest, textW);
    const startX = box.x + (align === "left" ? 0 : align === "right" ? box.w - groupW : (box.w - groupW) / 2);
    const cy = box.y + box.h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
    ctx.clip();
    if (el.icon) {
      const key = el.icon;
      const glyph = getGlyph(key);
      const col = glyph?.color ? readableOn(glyph.color, theme) : resolveColor(el.stroke, theme, "ink");
      drawGlyph(ctx, key, startX, cy - iconSize / 2, iconSize, col);
    }
    if (hasText) {
      ctx.fillStyle = resolveColor(el.color, theme, "ink");
      ctx.font = font;
      const tx = startX + iconSize + gap;
      const tw = Math.min(widest, textW);
      if (align === "center") drawLines(ctx, lines, tx + tw / 2, cy - blockH / 2, lh, "center");
      else if (align === "right") drawLines(ctx, lines, tx + tw, cy - blockH / 2, lh, "right");
      else drawLines(ctx, lines, tx, cy - blockH / 2, lh, "left");
    }
    ctx.restore();
  });
}

function drawText(env: Env, el: TextEl) {
  const { ctx, theme } = env;
  if (env.state.editingId === el.id) return;
  const size = el.fontSize;
  if (size * env.lod < 2.5) return;
  const font = textFont({ size, family: el.font, bold: el.bold, italic: el.italic });
  const lines = wrapLines(el.text, font, el.autoW ? 1e6 : Math.max(10, el.w));
  const lh = size * LINE_HEIGHT;
  withBox(ctx, el, () => {
    ctx.fillStyle = resolveColor(el.stroke, theme, "ink");
    ctx.font = font;
    const x = el.align === "center" ? el.w / 2 : el.align === "right" ? el.w : 0;
    drawLines(ctx, lines, x, 0, lh, el.align);
  });
}

function drawSticky(env: Env, el: StickyEl) {
  const { ctx } = env;
  withBox(ctx, el, () => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = resolveColor(el.fill, "light", "#fde68a");
    roundRectPath(ctx, 0, 0, el.w, el.h, 6);
    ctx.fill();
    ctx.restore();
    if (env.state.editingId === el.id || !el.text) return;
    const size = el.fontSize ?? 20;
    if (size * env.lod < 3) return;
    const font = textFont({ size, family: el.font ?? "hand" });
    const lines = wrapLines(el.text, font, el.w - 28);
    const lh = size * LINE_HEIGHT;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, el.w, el.h);
    ctx.clip();
    ctx.fillStyle = "#292524";
    ctx.font = font;
    drawLines(ctx, lines, 14, 14, lh, "left");
    ctx.restore();
  });
}

function drawFrame(env: Env, el: FrameEl) {
  const { ctx, theme, c } = env;
  withBox(ctx, el, () => {
    const accent = el.accent ? resolveColor(el.accent, theme) : null;
    const fill = el.fill ? resolveColor(el.fill, theme, "transparent") : accent ? withAlpha(accent, theme === "dark" ? 0.07 : 0.09) : withAlpha(c.ink, 0.03);
    const stroke = el.stroke ? resolveColor(el.stroke, theme) : accent ? withAlpha(accent, 0.55) : c.border;
    roundRectPath(ctx, 0, 0, el.w, el.h, 16);
    if (fill !== "transparent") {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    const sw = el.strokeWidth ?? 1.5;
    if (sw > 0) {
      ctx.lineWidth = sw;
      applyDash(ctx, el.dash, sw);
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (env.state.editingId === el.id || !el.title) return;
    if (14 * env.lod < 4) return;
    ctx.font = textFont({ size: 13, bold: true });
    ctx.fillStyle = accent ? readableOn(accent, theme) : c.muted;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(ellipsize(el.title, ctx.font, el.w - 32), 16, 13);
  });
}

function drawCard(env: Env, el: CardEl) {
  const { ctx, theme, c } = env;
  withBox(ctx, el, () => {
    const radius = 12;
    ctx.save();
    if (theme === "light") {
      ctx.shadowColor = "rgba(20,20,40,0.10)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    }
    roundRectPath(ctx, 0, 0, el.w, el.h, radius);
    ctx.fillStyle = resolveColor(el.fill, theme, "surface");
    ctx.fill();
    ctx.restore();
    const sw = el.strokeWidth ?? 1.25;
    roundRectPath(ctx, 0, 0, el.w, el.h, radius);
    ctx.lineWidth = sw;
    applyDash(ctx, el.dash, sw);
    ctx.strokeStyle = el.stroke ? resolveColor(el.stroke, theme) : c.border;
    ctx.stroke();
    ctx.setLineDash([]);

    const def = el.icon ? findIconDef(el.icon) : undefined;
    const glyph = el.icon ? getGlyph(el.icon) : null;
    const accent = el.accent ? resolveColor(el.accent, theme) : def?.color || glyph?.color || ACCENTS.indigo;
    const pad = 12;
    const tile = Math.min(40, el.h - pad * 2);
    let textX = pad + 2;
    if (el.icon && glyph) {
      const ty = (el.h - tile) / 2;
      roundRectPath(ctx, pad, ty, tile, tile, 10);
      ctx.fillStyle = withAlpha(accent, theme === "dark" ? 0.16 : 0.13);
      ctx.fill();
      const gcol = glyph.color && !el.accent ? readableOn(glyph.color, theme) : readableOn(accent, theme);
      const gs = tile * 0.56;
      drawGlyph(ctx, el.icon, pad + (tile - gs) / 2, ty + (tile - gs) / 2, gs, gcol);
      textX = pad + tile + 12;
    }
    if (env.state.editingId === el.id || env.lod < 0.22) return;
    const maxW = Math.max(20, el.w - textX - pad);
    const tFont = textFont({ size: 13.5, bold: true });
    const sFont = textFont({ size: 11.5 });
    const tLines = limitLines(wrapLines(el.title, tFont, maxW), el.subtitle ? 2 : 3, tFont, maxW);
    const sLines = el.subtitle ? limitLines(wrapLines(el.subtitle, sFont, maxW), 2, sFont, maxW) : [];
    const tlh = 13.5 * 1.28;
    const slh = 11.5 * 1.3;
    const total = tLines.length * tlh + (sLines.length ? 3 + sLines.length * slh : 0);
    let y = (el.h - total) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(textX - 2, 0, el.w - textX, el.h);
    ctx.clip();
    ctx.fillStyle = c.ink;
    ctx.font = tFont;
    drawLines(ctx, tLines, textX, y, tlh, "left");
    y += tLines.length * tlh + 3;
    if (sLines.length && env.lod >= 0.35) {
      ctx.fillStyle = c.muted;
      ctx.font = sFont;
      drawLines(ctx, sLines, textX, y, slh, "left");
    }
    ctx.restore();
  });
}

function drawIconEl(env: Env, el: IconEl) {
  const { ctx, theme, c } = env;
  withBox(ctx, el, () => {
    const labelH = el.label ? 22 : 0;
    const size = Math.max(8, Math.min(el.w, el.h - labelH));
    const glyph = getGlyph(el.icon);
    const natural = glyph?.color ? readableOn(glyph.color, theme) : null;
    const color = el.accent ? resolveColor(el.accent, theme) : natural || resolveColor(el.stroke, theme, "ink");
    drawGlyph(ctx, el.icon, (el.w - size) / 2, (el.h - labelH - size) / 2, size, color);
    if (el.label && env.state.editingId !== el.id && env.lod >= 0.3) {
      ctx.fillStyle = c.ink;
      ctx.font = textFont({ size: 12.5, bold: true });
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(ellipsize(el.label, ctx.font, Math.max(el.w, 90) + 40), el.w / 2, el.h - labelH + 5);
    }
  });
}

function drawTable(env: Env, el: TableEl) {
  const { ctx, theme, c } = env;
  withBox(ctx, el, () => {
    const accent = el.accent ? resolveColor(el.accent, theme) : ACCENTS.indigo;
    ctx.save();
    roundRectPath(ctx, 0, 0, el.w, el.h, 10);
    ctx.fillStyle = resolveColor(el.fill, theme, "surface");
    ctx.fill();
    ctx.clip();
    const headerH = 34;
    ctx.fillStyle = withAlpha(accent, theme === "dark" ? 0.22 : 0.16);
    ctx.fillRect(0, 0, el.w, headerH);
    if (env.lod >= 0.22) {
      ctx.fillStyle = c.ink;
      ctx.font = textFont({ size: 13, bold: true });
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(ellipsize(el.title, ctx.font, el.w - 24), 12, headerH / 2 + 0.5);
      const rowH = 26;
      const hasKey = el.columns.some((col) => col.key);
      el.columns.forEach((col, i) => {
        const y = headerH + i * rowH;
        if (y > el.h) return;
        if (i > 0) {
          ctx.fillStyle = c.border;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(0, y, el.w, 1);
          ctx.globalAlpha = 1;
        }
        let x = 12;
        if (hasKey) {
          if (col.key) {
            ctx.font = textFont({ size: 9, family: "mono", bold: true });
            ctx.fillStyle = col.key === "pk" ? "#eab308" : col.key === "fk" ? "#3b82f6" : c.muted;
            ctx.fillText(col.key.toUpperCase(), x, y + rowH / 2 + 0.5);
          }
          x += 24;
        }
        ctx.font = textFont({ size: 12.5 });
        ctx.fillStyle = c.ink;
        const typeW = col.type ? measureWidth(col.type, textFont({ size: 11, family: "mono" })) + 8 : 0;
        ctx.fillText(ellipsize(col.name, ctx.font, el.w - x - 12 - typeW), x, y + rowH / 2 + 0.5);
        if (col.type) {
          ctx.font = textFont({ size: 11, family: "mono" });
          ctx.fillStyle = c.muted;
          ctx.textAlign = "right";
          ctx.fillText(col.type, el.w - 12, y + rowH / 2 + 0.5);
          ctx.textAlign = "left";
        }
      });
    }
    ctx.restore();
    roundRectPath(ctx, 0, 0, el.w, el.h, 10);
    ctx.lineWidth = el.strokeWidth ?? 1.25;
    ctx.strokeStyle = el.stroke ? resolveColor(el.stroke, theme) : c.border;
    ctx.stroke();
  });
}

const penPaths = new Map<string, Path2D>();

function outlinePath(outline: number[][]): string {
  if (!outline.length) return "";
  const out: (string | number)[] = ["M", outline[0][0], outline[0][1], "Q"];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    out.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  out.push("Z");
  return out.join(" ");
}

function drawPen(env: Env, el: PenEl) {
  const { ctx, theme } = env;
  const sw = el.strokeWidth ?? 3;
  const key = `${el.id}|${el.pts.length}|${sw}|${el.highlighter ? 1 : 0}|${el.pts[el.pts.length - 1]}`;
  let p = penPaths.get(key);
  if (!p) {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < el.pts.length; i += 2) pts.push([el.pts[i], el.pts[i + 1]]);
    const outline = getStroke(pts, {
      size: el.highlighter ? sw * 6 + 6 : sw + 1.5,
      thinning: el.highlighter ? 0 : 0.45,
      smoothing: 0.6,
      streamline: 0.5,
      simulatePressure: !el.highlighter,
      last: true,
    });
    p = new Path2D(outlinePath(outline));
    if (penPaths.size > 1500) penPaths.clear();
    penPaths.set(key, p);
  }
  ctx.save();
  ctx.translate(el.x, el.y);
  if (el.highlighter) ctx.globalAlpha *= 0.38;
  ctx.fillStyle = resolveColor(el.stroke, theme, el.highlighter ? "#facc15" : "ink");
  ctx.fill(p);
  ctx.restore();
}

function drawImageEl(env: Env, el: ImageEl) {
  const { ctx, c } = env;
  const { img, status } = getImage(el.src, env.state.invalidate);
  withBox(ctx, el, () => {
    if (img) {
      roundRectPath(ctx, 0, 0, el.w, el.h, 6);
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, 0, 0, el.w, el.h);
      ctx.restore();
    } else {
      roundRectPath(ctx, 0, 0, el.w, el.h, 6);
      ctx.fillStyle = c.surface2;
      ctx.fill();
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.font = textFont({ size: 12 });
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(status === "error" ? "Image failed to load" : "Loading…", el.w / 2, el.h / 2);
    }
  });
}

/* --------------------------------------------------------------- connectors */

function drawHead(ctx: CanvasRenderingContext2D, kind: ArrowHead, tip: Point, angle: number, sw: number, color: string, fillColor: string) {
  if (kind === "none") return;
  const len = 9 + sw * 2.2;
  const half = len * 0.46;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(angle);
  ctx.setLineDash([]);
  ctx.lineWidth = sw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (kind) {
    case "arrow":
      ctx.moveTo(-len, -half);
      ctx.lineTo(0, 0);
      ctx.lineTo(-len, half);
      ctx.stroke();
      break;
    case "triangle":
      ctx.moveTo(0, 0);
      ctx.lineTo(-len, -half);
      ctx.lineTo(-len, half);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case "diamond":
      ctx.moveTo(0, 0);
      ctx.lineTo(-len * 0.6, -half);
      ctx.lineTo(-len * 1.2, 0);
      ctx.lineTo(-len * 0.6, half);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.stroke();
      break;
    case "dot":
      ctx.arc(-len * 0.35, 0, len * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.stroke();
      break;
    case "bar":
      ctx.moveTo(0, -half);
      ctx.lineTo(0, half);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawConnector(env: Env, el: ConnectorEl, selected: boolean) {
  const { ctx, theme, c } = env;
  const g: ConnectorGeom = env.geom.connector(el);
  if (g.pts.length < 2) return;
  const sw = el.strokeWidth ?? 2;
  const color = resolveColor(el.stroke, theme, "ink");
  const path = cachedPath2D(g.path);
  if (selected && env.state.chrome) {
    ctx.save();
    ctx.lineWidth = sw + 6 / env.lod + 2;
    ctx.strokeStyle = withAlpha(c.selection, 0.28);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.save();
  ctx.lineWidth = sw;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  applyDash(ctx, el.dash, sw);
  ctx.stroke(path);
  ctx.restore();
  const bg = c.bg;
  drawHead(ctx, el.startHead, g.start, g.startAngle, sw, color, bg);
  drawHead(ctx, el.endHead, g.end, g.endAngle, sw, color, bg);

  if (el.label && env.state.editingId !== el.id && env.lod >= 0.3) {
    const size = el.fontSize ?? 12;
    const font = textFont({ size, bold: true });
    const text = ellipsize(el.label, font, 240);
    const w = measureWidth(text, font) + 16;
    const h = size * 1.3 + 8;
    ctx.save();
    roundRectPath(ctx, g.label.p.x - w / 2, g.label.p.y - h / 2, w, h, h / 2.6);
    ctx.fillStyle = theme === "dark" ? c.surface : c.surface;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.border;
    ctx.stroke();
    ctx.fillStyle = c.ink;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, g.label.p.x, g.label.p.y + 0.5);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ dispatch */

function drawElement(env: Env, el: El, selected: boolean) {
  switch (el.type) {
    case "shape":
      return drawShape(env, el);
    case "text":
      return drawText(env, el);
    case "sticky":
      return drawSticky(env, el);
    case "frame":
      return drawFrame(env, el);
    case "card":
      return drawCard(env, el);
    case "icon":
      return drawIconEl(env, el);
    case "table":
      return drawTable(env, el);
    case "pen":
      return drawPen(env, el);
    case "image":
      return drawImageEl(env, el);
    case "connector":
      return drawConnector(env, el, selected);
  }
}

/* ----------------------------------------------------------------- overlays */

function drawBoxOutline(ctx: CanvasRenderingContext2D, box: Box, color: string, width: number, dash?: number[]) {
  const pts = boxCorners(box);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash ?? []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawSelectionUi(env: Env) {
  const { ctx, c, zoom, state } = env;
  const sb = state.selectionBox;
  const px = 1 / zoom;
  if (sb) {
    drawBoxOutline(ctx, sb.box, c.selection, 1.5 * px);
    if (sb.handles) {
      const size = 8 * px;
      ctx.save();
      for (const id of visibleHandles(sb.box, zoom)) {
        const p = handleWorldPoint(sb.box, id, zoom);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(sb.box.angle || 0);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = c.selection;
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, 2 * px);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (sb.rotatable) {
        const rp = handleWorldPoint(sb.box, "rotate", zoom);
        const tp = handleWorldPoint(sb.box, "n", zoom);
        ctx.strokeStyle = c.selection;
        ctx.lineWidth = 1.25 * px;
        ctx.beginPath();
        ctx.moveTo(tp.x, tp.y);
        ctx.lineTo(rp.x, rp.y);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 5 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  for (const p of state.connectorHandles) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = c.selection;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.5 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export const QUICK_ADD_OFFSET_PX = 24;
export const QUICK_ADD_RADIUS_PX = 10;

export function quickAddPoint(box: Box, side: Side, zoom: number): Point {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const off = QUICK_ADD_OFFSET_PX / zoom;
  const local =
    side === "top" ? { x: c.x, y: box.y - off } : side === "bottom" ? { x: c.x, y: box.y + box.h + off } : side === "left" ? { x: box.x - off, y: c.y } : { x: box.x + box.w + off, y: c.y };
  if (!box.angle) return local;
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const dx = local.x - c.x;
  const dy = local.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function drawQuickAdd(env: Env) {
  const { ctx, c, zoom, state } = env;
  const box = state.quickAdd;
  if (!box) return;
  const r = QUICK_ADD_RADIUS_PX / zoom;
  for (const side of ["top", "right", "bottom", "left"] as Side[]) {
    const p = quickAddPoint(box, side, zoom);
    const hot = state.quickAddHover === side;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, hot ? r * 1.12 : r, 0, Math.PI * 2);
    ctx.fillStyle = hot ? c.selection : c.surface;
    ctx.fill();
    ctx.lineWidth = 1.25 / zoom;
    ctx.strokeStyle = hot ? c.selection : c.border;
    ctx.stroke();
    ctx.strokeStyle = hot ? "#ffffff" : c.ink;
    ctx.lineWidth = 1.6 / zoom;
    ctx.lineCap = "round";
    const k = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(p.x - k, p.y);
    ctx.lineTo(p.x + k, p.y);
    ctx.moveTo(p.x, p.y - k);
    ctx.lineTo(p.x, p.y + k);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAnchors(env: Env) {
  const { ctx, c, zoom, state, store } = env;
  for (const t of state.anchorTargets) {
    const el = store.get(t.id);
    if (!el) continue;
    const r = 4.5 / zoom;
    ctx.save();
    ctx.strokeStyle = withAlpha(c.selection, 0.8);
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    const outline = boxCorners(el);
    ctx.beginPath();
    ctx.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(outline[i].x, outline[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const side of ["top", "right", "bottom", "left"] as Side[]) {
      const p = anchorFor(el, side);
      const active = t.side === side;
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? r * 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = active ? c.selection : "#ffffff";
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawGuides(env: Env) {
  const { ctx, c, zoom, state } = env;
  if (!state.guides.length) return;
  ctx.save();
  ctx.strokeStyle = c.guide;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const g of state.guides) {
    if (g.axis === "x") {
      ctx.moveTo(g.pos, g.from);
      ctx.lineTo(g.pos, g.to);
    } else {
      ctx.moveTo(g.from, g.pos);
      ctx.lineTo(g.to, g.pos);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------------------------------------- the frame */

export function renderScene(ctx: CanvasRenderingContext2D, store: DocStore, geom: GeometryCache, state: RenderState) {
  const { camera, width, height, dpr, view } = state;
  const theme = view.theme;
  const c = THEMES[theme];
  const z = camera.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = "high";
  if (state.background) {
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  if (state.chrome) drawGrid(ctx, camera, width, height, view, c);

  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * camera.x, dpr * camera.y);
  const env: Env = { ctx, theme, c, zoom: z, lod: state.exporting ? 1 : z, geom, store, state };
  const margin = 80 / z;
  const vis: Rect = { x: -camera.x / z - margin, y: -camera.y / z - margin, w: width / z + margin * 2, h: height / z + margin * 2 };

  for (const el of store.list()) {
    const b = geom.bounds(el);
    if (b.x > vis.x + vis.w || b.x + b.w < vis.x || b.y > vis.y + vis.h || b.y + b.h < vis.y) continue;
    const selected = state.selection.has(el.id);
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    if (state.fading.has(el.id)) ctx.globalAlpha *= 0.22;
    const started = state.anim.get(el.id);
    if (started !== undefined) {
      const p = clamp((state.now - started) / 280, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      ctx.globalAlpha *= e;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const s = 0.94 + 0.06 * e;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    }
    drawElement(env, el, selected);
    ctx.restore();
    if (state.chrome && !selected && state.hoverId === el.id && !state.fading.size) {
      ctx.save();
      if (el.type === "connector") {
        ctx.lineWidth = ((el.strokeWidth ?? 2) + 4) / z;
        ctx.strokeStyle = withAlpha(c.selection, 0.22);
        ctx.lineCap = "round";
        ctx.stroke(cachedPath2D(geom.connector(el).path));
      } else if (el.type !== "pen") {
        drawBoxOutline(ctx, el, withAlpha(c.selection, 0.7), 1.5 / z);
      }
      ctx.restore();
    }
  }

  if (!state.chrome) return;

  // Teammates: ghosts of what they're dragging / drawing, plus their selections.
  for (const peer of state.peers) {
    if (peer.drag) {
      for (const id of peer.drag.ids) {
        const el = store.get(id);
        if (!el || el.type === "connector") continue;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.translate(peer.drag.dx, peer.drag.dy);
        drawElement(env, el, false);
        drawBoxOutline(ctx, el, peer.color, 1.5 / z, [5 / z, 4 / z]);
        ctx.restore();
      }
    } else {
      for (const id of peer.selection) {
        const el = store.get(id);
        if (!el || el.type === "connector") continue;
        drawBoxOutline(ctx, el, withAlpha(peer.color, 0.9), 1.5 / z);
      }
    }
    if (peer.draft) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      drawElement(env, peer.draft, false);
      ctx.restore();
    }
  }

  if (state.draft) {
    ctx.save();
    drawElement(env, state.draft, false);
    ctx.restore();
  }

  drawAnchors(env);
  drawGuides(env);
  drawSelectionUi(env);
  drawQuickAdd(env);

  if (state.marquee) {
    const m = state.marquee;
    ctx.save();
    ctx.fillStyle = c.selectionFill;
    ctx.strokeStyle = c.selection;
    ctx.lineWidth = 1 / z;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.restore();
  }
}
