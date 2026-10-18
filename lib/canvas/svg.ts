import { getStroke } from "perfect-freehand";
import { getGlyph } from "./icons";
import { findIconDef } from "./icons-catalog";
import type { GeometryCache } from "./scene";
import { shapePaths, textBox } from "./shapes";
import { ellipsize, LINE_HEIGHT, measureWidth, textFont, wrapLines } from "./text";
import { ACCENTS, readableOn, resolveColor, THEMES, withAlpha } from "./theme";
import type { ArrowHead, ConnectorEl, Dash, El, ThemeName } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => +v.toFixed(2);

const FAMILY: Record<string, string> = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  hand: "'Comic Sans MS', 'Segoe Print', cursive",
  serif: "ui-serif, Georgia, serif",
};

/** `roundCaps: false` when the element already declares its own stroke-linecap (duplicate attributes make the SVG invalid XML). */
function dashAttr(dash: Dash | undefined, sw: number, roundCaps = true) {
  if (dash === "dashed") return ` stroke-dasharray="${n(sw * 3 + 5)} ${n(sw * 2 + 4)}"`;
  if (dash === "dotted") return ` stroke-dasharray="0.01 ${n(sw * 2 + 4)}"${roundCaps ? ' stroke-linecap="round"' : ""}`;
  return "";
}

function transformFor(el: { x: number; y: number; w: number; h: number; angle?: number }): string {
  if (!el.angle) return `translate(${n(el.x)} ${n(el.y)})`;
  return `translate(${n(el.x + el.w / 2)} ${n(el.y + el.h / 2)}) rotate(${n((el.angle * 180) / Math.PI)}) translate(${n(-el.w / 2)} ${n(-el.h / 2)})`;
}

function textLines(
  lines: string[],
  x: number,
  y: number,
  size: number,
  anchor: "start" | "middle" | "end",
  fill: string,
  family: string,
  weight: number | string,
  italic?: boolean
) {
  const lh = size * LINE_HEIGHT;
  const spans = lines
    .map((l, i) => `<tspan x="${n(x)}" y="${n(y + i * lh + size * 0.9 + (lh - size) / 2)}">${esc(l) || " "}</tspan>`)
    .join("");
  return `<text font-family="${esc(family)}" font-size="${size}" font-weight="${weight}"${italic ? ' font-style="italic"' : ""} text-anchor="${anchor}" fill="${fill}" xml:space="preserve">${spans}</text>`;
}

function glyphSvg(key: string | undefined, x: number, y: number, size: number, color: string): string {
  const g = getGlyph(key) || getGlyph("lucide:Box");
  if (!g) return "";
  const s = size / 24;
  const attrs = g.mode === "stroke" ? `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` : `fill="${color}"`;
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><path d="${g.d}" ${attrs}/></g>`;
}

function headSvg(kind: ArrowHead, tip: { x: number; y: number }, angle: number, sw: number, color: string, bg: string): string {
  if (kind === "none") return "";
  const len = 9 + sw * 2.2;
  const half = len * 0.46;
  const rot = `translate(${n(tip.x)} ${n(tip.y)}) rotate(${n((angle * 180) / Math.PI)})`;
  const common = `stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
  switch (kind) {
    case "arrow":
      return `<path transform="${rot}" d="M${n(-len)} ${n(-half)}L0 0L${n(-len)} ${n(half)}" fill="none" ${common}/>`;
    case "triangle":
      return `<path transform="${rot}" d="M0 0L${n(-len)} ${n(-half)}L${n(-len)} ${n(half)}Z" fill="${color}" ${common}/>`;
    case "diamond":
      return `<path transform="${rot}" d="M0 0L${n(-len * 0.6)} ${n(-half)}L${n(-len * 1.2)} 0L${n(-len * 0.6)} ${n(half)}Z" fill="${bg}" ${common}/>`;
    case "dot":
      return `<circle transform="${rot}" cx="${n(-len * 0.35)}" cy="0" r="${n(len * 0.35)}" fill="${bg}" ${common}/>`;
    case "bar":
      return `<path transform="${rot}" d="M0 ${n(-half)}L0 ${n(half)}" fill="none" ${common}/>`;
  }
}

function outlinePath(outline: number[][]): string {
  if (!outline.length) return "";
  const out: (string | number)[] = ["M", n(outline[0][0]), n(outline[0][1]), "Q"];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    out.push(n(x0), n(y0), n((x0 + x1) / 2), n((y0 + y1) / 2));
  }
  out.push("Z");
  return out.join(" ");
}

export function elementToSvg(el: El, theme: ThemeName, geom: GeometryCache): string {
  const c = THEMES[theme];
  const opacity = el.opacity !== undefined && el.opacity < 1 ? ` opacity="${el.opacity}"` : "";
  const wrap = (inner: string) => `<g${opacity}>${inner}</g>`;
  switch (el.type) {
    case "shape": {
      const { d, detail } = shapePaths(el.shape, el.w, el.h, el.radius ?? 12);
      const fill = resolveColor(el.fill, theme, "transparent");
      const sw = el.strokeWidth ?? 2;
      const stroke = resolveColor(el.stroke, theme, "ink");
      let inner = `<path d="${d}" fill="${fill === "transparent" ? "none" : fill}" stroke="${sw > 0 ? stroke : "none"}" stroke-width="${sw}" stroke-linejoin="round"${dashAttr(el.dash, sw)}/>`;
      if (detail) inner += `<path d="${detail}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
      if (el.text || el.icon) {
        const size = el.fontSize ?? 16;
        const family = FAMILY[el.font ?? "sans"];
        const font = textFont({ size, family: el.font ?? "sans", bold: el.bold, italic: el.italic });
        const box = textBox(el.shape, el.w, el.h);
        const iconSize = el.icon ? Math.max(16, Math.min(30, size * 1.6)) : 0;
        const gap = el.icon && el.text ? 8 : 0;
        const lines = el.text ? wrapLines(el.text, font, Math.max(10, box.w - iconSize - gap)) : [];
        const blockH = lines.length * size * LINE_HEIGHT;
        let widest = 0;
        for (const l of lines) widest = Math.max(widest, measureWidth(l, font));
        const total = iconSize + gap + widest;
        const startX = box.x + (box.w - total) / 2;
        const cy = box.y + box.h / 2;
        if (el.icon) {
          const g = getGlyph(el.icon);
          inner += glyphSvg(el.icon, startX, cy - iconSize / 2, iconSize, g?.color ? readableOn(g.color, theme) : stroke);
        }
        if (lines.length) {
          const align = el.align ?? "center";
          const tx = startX + iconSize + gap;
          const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
          const x = align === "left" ? tx : align === "right" ? tx + widest : tx + widest / 2;
          inner += textLines(lines, x, cy - blockH / 2, size, anchor, resolveColor(el.color, theme, "ink"), family, el.bold ? 600 : 400, el.italic);
        }
      }
      return wrap(`<g transform="${transformFor(el)}">${inner}</g>`);
    }
    case "text": {
      const size = el.fontSize;
      const font = textFont({ size, family: el.font, bold: el.bold, italic: el.italic });
      const lines = wrapLines(el.text, font, el.autoW ? 1e6 : Math.max(10, el.w));
      const x = el.align === "center" ? el.w / 2 : el.align === "right" ? el.w : 0;
      const anchor = el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
      return wrap(`<g transform="${transformFor(el)}">${textLines(lines, x, 0, size, anchor, resolveColor(el.stroke, theme, "ink"), FAMILY[el.font], el.bold ? 600 : 400, el.italic)}</g>`);
    }
    case "sticky": {
      const size = el.fontSize ?? 20;
      const font = textFont({ size, family: el.font ?? "hand" });
      const lines = wrapLines(el.text, font, el.w - 28);
      const body = `<rect width="${n(el.w)}" height="${n(el.h)}" rx="6" fill="${resolveColor(el.fill, "light", "#fde68a")}"/>${textLines(lines, 14, 14, size, "start", "#292524", FAMILY[el.font ?? "hand"], 400)}`;
      return wrap(`<g transform="${transformFor(el)}">${body}</g>`);
    }
    case "frame": {
      const accent = el.accent ? resolveColor(el.accent, theme) : null;
      const fill = el.fill ? resolveColor(el.fill, theme, "transparent") : accent ? withAlpha(accent, theme === "dark" ? 0.07 : 0.09) : withAlpha(c.ink, 0.03);
      const stroke = el.stroke ? resolveColor(el.stroke, theme) : accent ? withAlpha(accent, 0.55) : c.border;
      const sw = el.strokeWidth ?? 1.5;
      let inner = `<rect width="${n(el.w)}" height="${n(el.h)}" rx="16" fill="${fill === "transparent" ? "none" : fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttr(el.dash, sw)}/>`;
      if (el.title) {
        const f = textFont({ size: 13, bold: true });
        inner += `<text x="16" y="${n(13 + 12)}" font-family="${esc(FAMILY.sans)}" font-size="13" font-weight="600" fill="${accent ? readableOn(accent, theme) : c.muted}">${esc(ellipsize(el.title, f, el.w - 32))}</text>`;
      }
      return wrap(`<g transform="${transformFor(el)}">${inner}</g>`);
    }
    case "card": {
      const def = el.icon ? findIconDef(el.icon) : undefined;
      const glyph = el.icon ? getGlyph(el.icon) : null;
      const accent = el.accent ? resolveColor(el.accent, theme) : def?.color || glyph?.color || ACCENTS.indigo;
      const sw = el.strokeWidth ?? 1.25;
      let inner = `<rect width="${n(el.w)}" height="${n(el.h)}" rx="12" fill="${resolveColor(el.fill, theme, "surface")}" stroke="${el.stroke ? resolveColor(el.stroke, theme) : c.border}" stroke-width="${sw}"/>`;
      const pad = 12;
      const tile = Math.min(40, el.h - pad * 2);
      let textX = pad + 2;
      if (el.icon && glyph) {
        const ty = (el.h - tile) / 2;
        inner += `<rect x="${pad}" y="${n(ty)}" width="${tile}" height="${tile}" rx="10" fill="${withAlpha(accent, theme === "dark" ? 0.16 : 0.13)}"/>`;
        const gs = tile * 0.56;
        inner += glyphSvg(el.icon, pad + (tile - gs) / 2, ty + (tile - gs) / 2, gs, glyph.color && !el.accent ? readableOn(glyph.color, theme) : readableOn(accent, theme));
        textX = pad + tile + 12;
      }
      const maxW = Math.max(20, el.w - textX - pad);
      const tFont = textFont({ size: 13.5, bold: true });
      const sFont = textFont({ size: 11.5 });
      const tLines = wrapLines(el.title, tFont, maxW).slice(0, el.subtitle ? 2 : 3);
      const sLines = el.subtitle ? wrapLines(el.subtitle, sFont, maxW).slice(0, 2) : [];
      const tlh = 13.5 * 1.28;
      const slh = 11.5 * 1.3;
      const total = tLines.length * tlh + (sLines.length ? 3 + sLines.length * slh : 0);
      const y0 = (el.h - total) / 2;
      const tl = tLines.map((l, i) => `<tspan x="${n(textX)}" y="${n(y0 + i * tlh + 13.5 * 0.92)}">${esc(l)}</tspan>`).join("");
      inner += `<text font-family="${esc(FAMILY.sans)}" font-size="13.5" font-weight="600" fill="${c.ink}">${tl}</text>`;
      if (sLines.length) {
        const sy = y0 + tLines.length * tlh + 3;
        const sl = sLines.map((l, i) => `<tspan x="${n(textX)}" y="${n(sy + i * slh + 11.5 * 0.92)}">${esc(l)}</tspan>`).join("");
        inner += `<text font-family="${esc(FAMILY.sans)}" font-size="11.5" fill="${c.muted}">${sl}</text>`;
      }
      return wrap(`<g transform="${transformFor(el)}">${inner}</g>`);
    }
    case "icon": {
      const labelH = el.label ? 22 : 0;
      const size = Math.max(8, Math.min(el.w, el.h - labelH));
      const glyph = getGlyph(el.icon);
      const color = el.accent ? resolveColor(el.accent, theme) : glyph?.color ? readableOn(glyph.color, theme) : resolveColor(el.stroke, theme, "ink");
      let inner = glyphSvg(el.icon, (el.w - size) / 2, (el.h - labelH - size) / 2, size, color);
      if (el.label) inner += `<text x="${n(el.w / 2)}" y="${n(el.h - labelH + 5 + 12)}" text-anchor="middle" font-family="${esc(FAMILY.sans)}" font-size="12.5" font-weight="600" fill="${c.ink}">${esc(el.label)}</text>`;
      return wrap(`<g transform="${transformFor(el)}">${inner}</g>`);
    }
    case "table": {
      const accent = el.accent ? resolveColor(el.accent, theme) : ACCENTS.indigo;
      const clipId = `clip-${el.id.replace(/[^a-z0-9]/gi, "")}`;
      let inner = `<clipPath id="${clipId}"><rect width="${n(el.w)}" height="${n(el.h)}" rx="10"/></clipPath>`;
      inner += `<rect width="${n(el.w)}" height="${n(el.h)}" rx="10" fill="${resolveColor(el.fill, theme, "surface")}"/>`;
      inner += `<g clip-path="url(#${clipId})"><rect width="${n(el.w)}" height="34" fill="${withAlpha(accent, theme === "dark" ? 0.22 : 0.16)}"/>`;
      inner += `<text x="12" y="22" font-family="${esc(FAMILY.sans)}" font-size="13" font-weight="600" fill="${c.ink}">${esc(el.title)}</text>`;
      el.columns.forEach((col, i) => {
        const y = 34 + i * 26;
        if (i > 0) inner += `<rect y="${y}" width="${n(el.w)}" height="1" fill="${c.border}" opacity="0.5"/>`;
        const hasKey = el.columns.some((x) => x.key);
        let x = 12;
        if (hasKey) {
          if (col.key) inner += `<text x="12" y="${y + 17}" font-family="${esc(FAMILY.mono)}" font-size="9" font-weight="700" fill="${col.key === "pk" ? "#eab308" : col.key === "fk" ? "#3b82f6" : c.muted}">${col.key.toUpperCase()}</text>`;
          x += 24;
        }
        inner += `<text x="${x}" y="${y + 17}" font-family="${esc(FAMILY.sans)}" font-size="12.5" fill="${c.ink}">${esc(col.name)}</text>`;
        if (col.type) inner += `<text x="${n(el.w - 12)}" y="${y + 17}" text-anchor="end" font-family="${esc(FAMILY.mono)}" font-size="11" fill="${c.muted}">${esc(col.type)}</text>`;
      });
      inner += `</g><rect width="${n(el.w)}" height="${n(el.h)}" rx="10" fill="none" stroke="${el.stroke ? resolveColor(el.stroke, theme) : c.border}" stroke-width="${el.strokeWidth ?? 1.25}"/>`;
      return wrap(`<g transform="${transformFor(el)}">${inner}</g>`);
    }
    case "pen": {
      const pts: [number, number][] = [];
      for (let i = 0; i + 1 < el.pts.length; i += 2) pts.push([el.pts[i], el.pts[i + 1]]);
      const sw = el.strokeWidth ?? 3;
      const outline = getStroke(pts, {
        size: el.highlighter ? sw * 6 + 6 : sw + 1.5,
        thinning: el.highlighter ? 0 : 0.45,
        smoothing: 0.6,
        streamline: 0.5,
        simulatePressure: !el.highlighter,
        last: true,
      });
      const fill = resolveColor(el.stroke, theme, el.highlighter ? "#facc15" : "ink");
      return wrap(`<path transform="translate(${n(el.x)} ${n(el.y)})" d="${outlinePath(outline)}" fill="${fill}"${el.highlighter ? ' fill-opacity="0.38"' : ""}/>`);
    }
    case "image":
      return wrap(`<g transform="${transformFor(el)}"><image href="${esc(el.src)}" width="${n(el.w)}" height="${n(el.h)}" preserveAspectRatio="none"/></g>`);
    case "connector": {
      const g = geom.connector(el as ConnectorEl);
      if (g.pts.length < 2) return "";
      const sw = el.strokeWidth ?? 2;
      const color = resolveColor(el.stroke, theme, "ink");
      let inner = `<path d="${g.path}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"${dashAttr(el.dash, sw, false)}/>`;
      inner += headSvg(el.startHead, g.start, g.startAngle, sw, color, c.bg);
      inner += headSvg(el.endHead, g.end, g.endAngle, sw, color, c.bg);
      if (el.label) {
        const size = el.fontSize ?? 12;
        const font = textFont({ size, bold: true });
        const text = ellipsize(el.label, font, 240);
        const w = measureWidth(text, font) + 16;
        const h = size * 1.3 + 8;
        inner += `<rect x="${n(g.label.p.x - w / 2)}" y="${n(g.label.p.y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2.6)}" fill="${c.surface}" stroke="${c.border}"/>`;
        inner += `<text x="${n(g.label.p.x)}" y="${n(g.label.p.y + size * 0.36)}" text-anchor="middle" font-family="${esc(FAMILY.sans)}" font-size="${size}" font-weight="600" fill="${c.ink}">${esc(text)}</text>`;
      }
      return wrap(inner);
    }
  }
}
