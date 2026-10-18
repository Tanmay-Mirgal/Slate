import { fontString } from "./theme";
import type { FontFamily } from "./types";

export const LINE_HEIGHT = 1.32;

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getCtx() {
  if (measureCtx) return measureCtx;
  if (typeof OffscreenCanvas !== "undefined") {
    measureCtx = new OffscreenCanvas(4, 4).getContext("2d");
  } else if (typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  return measureCtx;
}

const widthCache = new Map<string, number>();
const wrapCache = new Map<string, string[]>();

function cap<K, V>(m: Map<K, V>, max: number) {
  if (m.size > max) {
    const first = m.keys().next();
    if (!first.done) m.delete(first.value);
  }
}

export function clearTextCaches() {
  widthCache.clear();
  wrapCache.clear();
}

/** Server-safe approximation (no canvas available). Slightly conservative on purpose. */
export function estimateWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    if ("iljtfI.,:;'|!()[]` ".includes(ch)) w += ch === " " ? 0.28 : 0.32;
    else if ("mwMW@%".includes(ch)) w += 0.86;
    else if (ch >= "A" && ch <= "Z") w += 0.66;
    else if (ch >= "0" && ch <= "9") w += 0.58;
    else if (ch.charCodeAt(0) > 0x2e80) w += 1.0;
    else w += 0.55;
  }
  return w * size * (bold ? 1.06 : 1.02);
}

export function measureWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = getCtx();
  let w: number;
  if (ctx) {
    ctx.font = font;
    w = ctx.measureText(text).width;
  } else {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || "14");
    w = estimateWidth(text, size, /\b[6-9]00\b|bold/.test(font));
  }
  widthCache.set(key, w);
  cap(widthCache, 20000);
  return w;
}

/** Greedy word wrap honouring explicit newlines; breaks over-long words by character. */
export function wrapLines(text: string, font: string, maxWidth: number): string[] {
  const key = `${font}|${Math.round(maxWidth)}|${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  const lines: string[] = [];
  const limit = Math.max(8, maxWidth);
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    const words = para.split(/(\s+)/).filter((w) => w.length > 0);
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (measureWidth(candidate, font) <= limit) {
        line = candidate;
        continue;
      }
      // Does not fit on the current line: flush it and start a new one.
      if (line.trim() !== "") {
        lines.push(line.trimEnd());
        line = "";
      }
      const w = word.trimStart();
      if (!w) continue;
      if (measureWidth(w, font) <= limit) {
        line = w;
        continue;
      }
      // A single word wider than the whole line: break it by character.
      let chunk = "";
      for (const ch of w) {
        if (chunk && measureWidth(chunk + ch, font) > limit) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    lines.push(line.trimEnd());
  }
  wrapCache.set(key, lines);
  cap(wrapCache, 6000);
  return lines;
}

export interface TextStyle {
  size: number;
  family?: FontFamily;
  bold?: boolean;
  italic?: boolean;
}

export function textFont(s: TextStyle): string {
  return fontString(s);
}

export function measureBlock(text: string, style: TextStyle, maxWidth?: number) {
  const font = textFont(style);
  const lines = maxWidth ? wrapLines(text, font, maxWidth) : text.split("\n");
  let w = 0;
  for (const l of lines) w = Math.max(w, measureWidth(l, font));
  return { lines, w, h: lines.length * style.size * LINE_HEIGHT, lineHeight: style.size * LINE_HEIGHT };
}

/** Truncates `text` with an ellipsis so it fits `maxWidth`. */
export function ellipsize(text: string, font: string, maxWidth: number): string {
  if (measureWidth(text, font) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureWidth(text.slice(0, mid) + "…", font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, Math.max(0, lo)).trimEnd() + "…";
}

let fontsRequested = false;
/** Kicks off loading of the canvas fonts; resolves when they are usable. */
export async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts || fontsRequested) return;
  fontsRequested = true;
  const families: FontFamily[] = ["sans", "mono", "hand"];
  try {
    await Promise.all(
      families.flatMap((f) => [
        document.fonts.load(fontString({ size: 16, family: f })),
        document.fonts.load(fontString({ size: 16, family: f, bold: true })),
      ])
    );
    await document.fonts.ready;
    clearTextCaches();
  } catch {
    /* fonts are best-effort */
  }
}
