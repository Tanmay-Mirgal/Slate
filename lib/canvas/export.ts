import { frameChildren, GeometryCache } from "./scene";
import { unionRects } from "./geometry";
import { preloadImages } from "./images";
import { normalizeMany } from "./normalize";
import { renderScene, type RenderState } from "./render";
import { elementToSvg } from "./svg";
import { DocStore } from "./store";
import { THEMES } from "./theme";
import type { Engine } from "./engine";
import type { El, Rect, ThemeName } from "./types";

export interface ExportOptions {
  scale: number;
  padding: number;
  transparent: boolean;
  selectionOnly: boolean;
  branding: boolean;
  theme?: ThemeName;
}

export const DEFAULT_EXPORT: ExportOptions = {
  scale: 2,
  padding: 40,
  transparent: false,
  selectionOnly: false,
  branding: true,
};

const MAX_SIDE = 8192;
const MAX_PIXELS = 48_000_000;

export function collectExportElements(engine: Engine, selectionOnly: boolean): El[] {
  const all = engine.store.list();
  if (!selectionOnly || engine.selection.size === 0) return [...all];
  const ids = new Set(engine.selection);
  for (const id of Array.from(ids)) {
    const el = engine.store.get(id);
    if (el?.type === "frame") for (const c of frameChildren(engine.store, engine.geom, el)) ids.add(c.id);
  }
  // connectors whose both endpoints made the cut
  for (const el of all) {
    if (el.type === "connector" && el.start && el.end && ids.has(el.start.id) && ids.has(el.end.id)) ids.add(el.id);
  }
  return all.filter((e) => ids.has(e.id));
}

function scratch(els: El[]) {
  const store = new DocStore();
  store.load(els);
  return { store, geom: new GeometryCache(store) };
}

export function exportBounds(engine: Engine, els: El[], padding: number): Rect | null {
  const { geom } = scratch(els);
  const b = unionRects(els.map((e) => geom.bounds(e)));
  if (!b) return null;
  return { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 };
}

export async function exportPng(engine: Engine, opts: ExportOptions): Promise<Blob | null> {
  const els = collectExportElements(engine, opts.selectionOnly);
  if (els.length === 0) return null;
  const theme = opts.theme ?? engine.view.theme;
  const brandingH = opts.branding ? 56 : 0;
  const base = exportBounds(engine, els, opts.padding);
  if (!base) return null;
  const rect: Rect = { ...base, h: base.h + brandingH };

  let scale = opts.scale;
  scale = Math.min(scale, MAX_SIDE / rect.w, MAX_SIDE / rect.h, Math.sqrt(MAX_PIXELS / (rect.w * rect.h)));
  scale = Math.max(0.05, scale);
  const pw = Math.max(1, Math.round(rect.w * scale));
  const ph = Math.max(1, Math.round(rect.h * scale));

  await preloadImages(els.filter((e) => e.type === "image").map((e) => (e.type === "image" ? e.src : "")));
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { store, geom } = scratch(els);
  const state: RenderState = {
    camera: { x: -rect.x * scale, y: -rect.y * scale, zoom: scale },
    width: pw,
    height: ph,
    dpr: 1,
    view: { ...engine.view, theme, grid: "none" },
    selection: new Set(),
    hoverId: null,
    editingId: null,
    fading: new Set(),
    draft: null,
    peers: [],
    marquee: null,
    guides: [],
    anchorTargets: [],
    selectionBox: null,
    connectorHandles: [],
    quickAdd: null,
    quickAddHover: null,
    anim: new Map(),
    now: performance.now(),
    chrome: false,
    background: !opts.transparent,
    exporting: true,
    invalidate: () => undefined,
  };
  renderScene(ctx, store, geom, state);

  if (opts.branding) await drawBranding(ctx, rect, scale, theme);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

async function drawBranding(ctx: CanvasRenderingContext2D, rect: Rect, scale: number, theme: ThemeName) {
  const c = THEMES[theme];
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const right = rect.w - 24;
  const bottom = rect.h - 14;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillStyle = c.ink;
  ctx.font = "800 22px ui-sans-serif, system-ui, sans-serif";
  const textW = ctx.measureText("Slate").width;
  ctx.fillText("Slate", right, bottom - 14);
  ctx.fillStyle = c.muted;
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Powered by Tanmay Mirgal", right, bottom + 2);
  try {
    const img = new Image();
    img.src = "/logo.svg";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo"));
    });
    ctx.drawImage(img, right - textW - 40, bottom - 36, 30, 30);
  } catch {
    /* branding logo is optional */
  }
  ctx.restore();
}

export function exportSvg(engine: Engine, opts: ExportOptions): string | null {
  const els = collectExportElements(engine, opts.selectionOnly);
  if (els.length === 0) return null;
  const theme = opts.theme ?? engine.view.theme;
  const rect = exportBounds(engine, els, opts.padding);
  if (!rect) return null;
  const { geom } = scratch(els);
  const c = THEMES[theme];
  const body = els.map((e) => elementToSvg(e, theme, geom)).join("\n");
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const bg = opts.transparent ? "" : `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${c.bg}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${rect.x} ${rect.y} ${rect.w} ${rect.h}" width="${w}" height="${h}">\n${bg}\n${body}\n</svg>\n`;
}

export interface BoardFile {
  kind: "slate-board";
  version: 2;
  elements: El[];
}

export function exportJson(engine: Engine, selectionOnly = false): string {
  const file: BoardFile = { kind: "slate-board", version: 2, elements: collectExportElements(engine, selectionOnly) };
  return JSON.stringify(file, null, 2);
}

export function parseBoardFile(text: string): El[] {
  const data = JSON.parse(text);
  if (!data || data.kind !== "slate-board" || !Array.isArray(data.elements)) throw new Error("Not a Slate board file");
  return normalizeMany(data.elements);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name: string, ext: string): string {
  const base = (name || "slate").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "slate";
  return `${base}.${ext}`;
}

export async function copyPngToClipboard(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
