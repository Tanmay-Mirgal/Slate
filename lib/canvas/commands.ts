import type { Engine } from "./engine";
import { cardSize, createCard, createConnector, createImage, createText, DEFAULT_SIZES, textSize, type StyleDefaults } from "./create";
import { rectsOverlap, unionRects, inflate, boxBounds } from "./geometry";
import { prepareImageFile, blobToDataUrl } from "./images";
import { newId } from "./ids";
import { normalizeMany } from "./normalize";
import { OPPOSITE, sideVector } from "./router";
import { frameChildren, selectionBounds } from "./scene";
import type { ArrowHead, ConnectorEl, Dash, El, FontFamily, Point, Rect, Route, Side, TextAlign } from "./types";

/* ------------------------------------------------------------------ delete */

/** Ids plus every connector attached to any of them. */
export function withAttachedConnectors(e: Engine, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (const el of e.store.els.values()) {
    if (el.type !== "connector") continue;
    if ((el.start && out.has(el.start.id)) || (el.end && out.has(el.end.id))) out.add(el.id);
  }
  return out;
}

export function deleteElements(e: Engine, ids: Iterable<string>) {
  if (e.readOnly) return;
  const all = withAttachedConnectors(e, ids);
  e.store.removeMany(all);
  e.clearSelection();
}

export function deleteSelection(e: Engine) {
  if (e.selection.size === 0) return;
  deleteElements(e, e.selection);
}

/* ------------------------------------------------------------- cloning etc. */

export interface CloneResult {
  els: El[];
  map: Map<string, string>;
}

/** Deep copies elements with fresh ids, preserving groups and connector bindings between them. */
export function cloneElements(e: Engine, src: El[], offset: Point): CloneResult {
  const map = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const el of src) map.set(el.id, newId(el.id.charAt(0)));
  const baseZ = e.store.nextZ();
  const ordered = [...src].sort((a, b) => a.z - b.z);
  const zOf = new Map(ordered.map((el, i) => [el.id, baseZ + i]));
  const els = src.map((el): El => {
    const copy: El = { ...el, id: map.get(el.id)!, z: zOf.get(el.id)! };
    delete copy.diagramId;
    if (el.groupId) {
      if (!groups.has(el.groupId)) groups.set(el.groupId, newId("g"));
      copy.groupId = groups.get(el.groupId);
    }
    if (copy.type === "connector") {
      const c = copy as ConnectorEl;
      const sOk = c.start && map.has(c.start.id);
      const eOk = c.end && map.has(c.end.id);
      c.start = sOk ? { ...c.start!, id: map.get(c.start!.id)! } : undefined;
      c.end = eOk ? { ...c.end!, id: map.get(c.end!.id)! } : undefined;
      c.points = c.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
      c.x += offset.x;
      c.y += offset.y;
      delete c.routeSig;
      if (!c.start && !c.end && c.points.length < 2) c.points = [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y + c.h }];
      return c;
    }
    copy.x += offset.x;
    copy.y += offset.y;
    return copy;
  });
  return { els, map };
}

export function duplicateSelection(e: Engine) {
  if (e.readOnly || e.selection.size === 0) return;
  const src = e.selectedElements();
  const { els } = cloneElements(e, src, { x: 28, y: 28 });
  e.store.putMany(els);
  e.select(els.map((x) => x.id), { expandGroup: false });
}

/* --------------------------------------------------------------- clipboard */

const CLIP_MARK = "slate-clipboard/v1";

export function serializeSelection(e: Engine, els = e.selectedElements()): string {
  const ids = new Set(els.map((x) => x.id));
  // include frame children so copying a frame copies what's inside
  for (const el of els) if (el.type === "frame") for (const c of frameChildren(e.store, e.geom, el)) ids.add(c.id);
  const list = Array.from(ids).map((id) => e.store.get(id)!).filter(Boolean);
  return JSON.stringify({ kind: CLIP_MARK, elements: list });
}

export async function copySelection(e: Engine) {
  if (e.selection.size === 0) return;
  const payload = serializeSelection(e);
  e.clipboardMemo = JSON.parse(payload).elements;
  try {
    await navigator.clipboard?.writeText(payload);
  } catch {
    /* clipboard permission denied: the in-memory copy still works inside this tab */
  }
}

export async function cutSelection(e: Engine) {
  if (e.readOnly) return;
  await copySelection(e);
  deleteSelection(e);
}

export function parseClipboard(text: string): El[] | null {
  try {
    const data = JSON.parse(text);
    if (data && data.kind === CLIP_MARK) return normalizeMany(data.elements);
  } catch {
    /* not ours */
  }
  return null;
}

export function pasteElements(e: Engine, src: El[], at?: Point) {
  if (e.readOnly || src.length === 0) return;
  const b = unionRects(src.map((el) => (el.type === "connector" ? connectorRect(el) : boxBounds(el))));
  let offset: Point;
  if (at && b) offset = { x: at.x - (b.x + b.w / 2), y: at.y - (b.y + b.h / 2) };
  else {
    e.pasteCount++;
    offset = { x: 28 * e.pasteCount, y: 28 * e.pasteCount };
  }
  const { els } = cloneElements(e, src, offset);
  e.store.putMany(els);
  e.select(els.map((x) => x.id), { expandGroup: false });
  const now = performance.now();
  for (const el of els) e.anim.set(el.id, now);
  e.requestRender();
}

export async function pasteText(e: Engine, text: string, at?: Point) {
  const parsed = parseClipboard(text);
  if (parsed) return pasteElements(e, parsed, at);
  if (text.trim()) {
    const p = at ?? e.screenToWorld({ x: e.width / 2, y: e.height / 2 });
    const t = createText(p, e.style, e.store.nextZ(), text.trim().slice(0, 4000));
    e.store.put(t);
    e.select([t.id]);
  }
}

export async function pasteImages(e: Engine, files: File[], at?: Point) {
  for (const f of files) await insertImageFile(e, f, at);
}

function connectorRect(c: ConnectorEl): Rect {
  const r = unionRects(c.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
  return r ?? { x: c.x, y: c.y, w: c.w, h: c.h };
}

/* ------------------------------------------------------------------- groups */

export function groupSelection(e: Engine) {
  if (e.readOnly || e.selection.size < 2) return;
  const gid = newId("g");
  e.store.patchMany(e.selection, () => ({ groupId: gid }));
  e.scheduleUi();
}

export function ungroupSelection(e: Engine) {
  if (e.readOnly) return;
  e.store.patchMany(e.selection, (el) => (el.groupId ? { groupId: undefined } : null));
  e.enteredGroup = null;
  e.scheduleUi();
}

export function setLocked(e: Engine, locked: boolean) {
  if (e.readOnly) return;
  e.store.patchMany(e.selection, () => ({ locked: locked || undefined }));
  e.scheduleUi();
}

/* ------------------------------------------------------------------ z-order */

export type ZOp = "front" | "back" | "forward" | "backward";

export function reorder(e: Engine, op: ZOp) {
  if (e.readOnly || e.selection.size === 0) return;
  const sel = e.selectedElements().sort((a, b) => a.z - b.z);
  if (sel.length === 0) return;
  const all = e.store.list();
  const selIds = new Set(sel.map((s) => s.id));
  const patches = new Map<string, number>();

  if (op === "front") {
    const top = e.store.maxZ();
    sel.forEach((el, i) => patches.set(el.id, top + 1 + i));
  } else if (op === "back") {
    const bottom = e.store.minZ();
    sel.forEach((el, i) => patches.set(el.id, bottom - sel.length + i));
  } else if (op === "forward") {
    const maxSel = sel[sel.length - 1].z;
    const above = all.filter((x) => !selIds.has(x.id) && x.z > maxSel);
    if (above.length === 0) return;
    const next = above[0];
    const after = above[1];
    const hi = after ? after.z : next.z + 1;
    const step = (hi - next.z) / (sel.length + 1);
    sel.forEach((el, i) => patches.set(el.id, next.z + step * (i + 1)));
  } else {
    const minSel = sel[0].z;
    const below = all.filter((x) => !selIds.has(x.id) && x.z < minSel);
    if (below.length === 0) return;
    const prev = below[below.length - 1];
    const before = below[below.length - 2];
    const lo = before ? before.z : prev.z - 1;
    const step = (prev.z - lo) / (sel.length + 1);
    sel.forEach((el, i) => patches.set(el.id, lo + step * (i + 1)));
  }
  e.store.patchMany(patches.keys(), (el) => ({ z: patches.get(el.id)! }));
}

/* ---------------------------------------------------------- align / distribute */

export type AlignOp = "left" | "center" | "right" | "top" | "middle" | "bottom";

function moveEl(e: Engine, el: El, dx: number, dy: number): Partial<El> | null {
  if (!dx && !dy) return null;
  if (el.type === "connector") {
    const c = el as ConnectorEl;
    if (c.start && c.end) return null;
    const pts = c.points.map((p, i) => {
      const last = i === c.points.length - 1;
      if ((i === 0 && c.start) || (last && c.end)) return p;
      return { x: p.x + dx, y: p.y + dy };
    });
    return { points: pts, x: c.x + dx, y: c.y + dy, routeSig: undefined } as Partial<El>;
  }
  return { x: el.x + dx, y: el.y + dy };
}

export function alignSelection(e: Engine, op: AlignOp) {
  if (e.readOnly) return;
  const els = e.selectedElements().filter((x) => x.type !== "connector" && !x.locked);
  if (els.length < 2) return;
  const bounds = els.map((x) => ({ el: x, b: e.geom.bounds(x) }));
  const u = unionRects(bounds.map((x) => x.b))!;
  e.store.patchMany(
    els.map((x) => x.id),
    (el) => {
      const b = bounds.find((x) => x.el.id === el.id)!.b;
      let dx = 0;
      let dy = 0;
      if (op === "left") dx = u.x - b.x;
      if (op === "right") dx = u.x + u.w - (b.x + b.w);
      if (op === "center") dx = u.x + u.w / 2 - (b.x + b.w / 2);
      if (op === "top") dy = u.y - b.y;
      if (op === "bottom") dy = u.y + u.h - (b.y + b.h);
      if (op === "middle") dy = u.y + u.h / 2 - (b.y + b.h / 2);
      return moveEl(e, el, dx, dy);
    }
  );
}

export function distributeSelection(e: Engine, axis: "x" | "y") {
  if (e.readOnly) return;
  const els = e.selectedElements().filter((x) => x.type !== "connector" && !x.locked);
  if (els.length < 3) return;
  const items = els.map((el) => ({ el, b: e.geom.bounds(el) })).sort((a, b) => (axis === "x" ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const totalSize = items.reduce((s, i) => s + (axis === "x" ? i.b.w : i.b.h), 0);
  const span = axis === "x" ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - totalSize) / (items.length - 1);
  let cursor = axis === "x" ? first.x : first.y;
  const deltas = new Map<string, number>();
  for (const it of items) {
    const cur = axis === "x" ? it.b.x : it.b.y;
    deltas.set(it.el.id, cursor - cur);
    cursor += (axis === "x" ? it.b.w : it.b.h) + gap;
  }
  e.store.patchMany(deltas.keys(), (el) => (axis === "x" ? moveEl(e, el, deltas.get(el.id)!, 0) : moveEl(e, el, 0, deltas.get(el.id)!)));
}

export function flipSelection(e: Engine, axis: "h" | "v") {
  if (e.readOnly) return;
  const els = e.selectedElements().filter((x) => !x.locked);
  const b = selectionBounds(e.geom, els);
  if (!b || els.length === 0) return;
  e.store.patchMany(
    els.map((x) => x.id),
    (el) => {
      if (el.type === "connector") {
        const c = el as ConnectorEl;
        if (c.start && c.end) return null;
        const pts = c.points.map((p) => (axis === "h" ? { x: 2 * b.x + b.w - p.x, y: p.y } : { x: p.x, y: 2 * b.y + b.h - p.y }));
        return { points: pts, routeSig: undefined } as Partial<El>;
      }
      const patch: Partial<El> = axis === "h" ? { x: 2 * b.x + b.w - (el.x + el.w) } : { y: 2 * b.y + b.h - (el.y + el.h) };
      if (el.angle) patch.angle = -el.angle;
      if (el.type === "pen") {
        const pts = el.pts.slice();
        for (let i = 0; i + 1 < pts.length; i += 2) {
          if (axis === "h") pts[i] = el.w - pts[i];
          else pts[i + 1] = el.h - pts[i + 1];
        }
        (patch as Partial<typeof el>).pts = pts;
      }
      return patch;
    }
  );
}

export function nudgeSelection(e: Engine, dx: number, dy: number) {
  if (e.readOnly || e.selection.size === 0) return;
  const ids = new Set(e.selection);
  // frames carry their contents
  for (const el of e.selectedElements()) if (el.type === "frame") for (const c of frameChildren(e.store, e.geom, el)) ids.add(c.id);
  e.store.patchMany(ids, (el) => (el.locked ? null : moveEl(e, el, dx, dy)));
}

/* ------------------------------------------------------------------- styling */

export interface StylePatch {
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: Dash;
  opacity?: number;
  fontSize?: number;
  font?: FontFamily;
  align?: TextAlign;
  textColor?: string;
  route?: Route;
  startHead?: ArrowHead;
  endHead?: ArrowHead;
  radius?: number;
}

export function applyStyle(e: Engine, patch: StylePatch) {
  // Remember choices for the next element the user draws.
  const defaults: Partial<StyleDefaults> = {};
  for (const k of ["stroke", "fill", "strokeWidth", "dash", "opacity", "fontSize", "font", "align", "route", "startHead", "endHead"] as const) {
    if (patch[k] !== undefined) (defaults as Record<string, unknown>)[k] = patch[k];
  }
  if (patch.fill !== undefined && e.selectedElements().some((x) => x.type === "sticky")) defaults.stickyColor = patch.fill;
  if (Object.keys(defaults).length) {
    e.style = { ...e.style, ...defaults };
  }
  if (e.readOnly || e.selection.size === 0) {
    e.scheduleUi();
    return;
  }
  e.store.patchMany(e.selection, (el) => {
    const out: Record<string, unknown> = {};
    const t = el.type;
    if (patch.stroke !== undefined) {
      if (t === "icon") out.accent = patch.stroke === "ink" ? undefined : patch.stroke;
      else if (t === "card") out.accent = patch.stroke === "ink" ? undefined : patch.stroke;
      else if (t !== "image" && t !== "sticky") out.stroke = patch.stroke;
    }
    if (patch.fill !== undefined && (t === "shape" || t === "frame" || t === "card" || t === "table" || t === "sticky")) out.fill = patch.fill;
    if (patch.strokeWidth !== undefined && t !== "image" && t !== "sticky" && t !== "icon") out.strokeWidth = patch.strokeWidth;
    if (patch.dash !== undefined && t !== "image" && t !== "sticky" && t !== "icon" && t !== "text") out.dash = patch.dash === "solid" ? undefined : patch.dash;
    if (patch.opacity !== undefined) out.opacity = patch.opacity >= 1 ? undefined : patch.opacity;
    if (patch.fontSize !== undefined && (t === "shape" || t === "sticky" || t === "text" || t === "connector")) {
      out.fontSize = patch.fontSize;
      if (t === "text") {
        const s = textSize(el.text, { ...el, fontSize: patch.fontSize }, el.autoW ? undefined : el.w);
        out.w = el.autoW ? s.w : el.w;
        out.h = s.h;
      }
    }
    if (patch.font !== undefined && (t === "shape" || t === "sticky" || t === "text")) {
      out.font = patch.font;
      if (t === "text") {
        const s = textSize(el.text, { ...el, font: patch.font }, el.autoW ? undefined : el.w);
        out.w = el.autoW ? s.w : el.w;
        out.h = s.h;
      }
    }
    if (patch.align !== undefined && (t === "shape" || t === "text")) out.align = patch.align;
    if (patch.textColor !== undefined && t === "shape") out.color = patch.textColor === "ink" ? undefined : patch.textColor;
    if (patch.route !== undefined && t === "connector") out.route = patch.route;
    if (patch.startHead !== undefined && t === "connector") out.startHead = patch.startHead;
    if (patch.endHead !== undefined && t === "connector") out.endHead = patch.endHead;
    if (patch.radius !== undefined && t === "shape" && el.shape === "rect") out.radius = patch.radius;
    return Object.keys(out).length ? (out as Partial<El>) : null;
  });
  e.scheduleUi();
}

/* ------------------------------------------------------------ placement util */

function allBounds(e: Engine): Rect[] {
  return e.store.list().map((el) => e.geom.bounds(el));
}

export function findFreeRect(e: Engine, w: number, h: number, pad = 60): Point {
  const existing = allBounds(e);
  const vp = e.viewport();
  const center = { x: vp.x + vp.w / 2 - w / 2, y: vp.y + vp.h / 2 - h / 2 };
  const collides = (x: number, y: number) => existing.some((r) => rectsOverlap(inflate({ x, y, w, h }, pad / 2), r));
  if (!collides(center.x, center.y)) return center;
  const content = unionRects(existing)!;
  const candidates: Point[] = [
    { x: content.x + content.w + 140, y: content.y },
    { x: content.x, y: content.y + content.h + 140 },
    { x: content.x - w - 140, y: content.y },
    { x: content.x, y: content.y - h - 140 },
  ];
  for (const c of candidates) if (!collides(c.x, c.y)) return c;
  return { x: content.x + content.w + 140, y: content.y };
}

export interface InsertOptions {
  /** Where to put the content's top-left; "free" finds an empty spot near the viewport. */
  at?: "free" | "center" | Point;
  select?: boolean;
  fit?: boolean;
}

/** Inserts pre-built elements (AI output, templates, imports) as a single undoable step. */
export function insertElements(e: Engine, src: El[], opts: InsertOptions = {}): { ids: string[]; bounds: Rect } | null {
  if (e.readOnly || src.length === 0) return null;
  const rects = src.map((el) => (el.type === "connector" ? connectorRect(el) : boxBounds(el)));
  const b = unionRects(rects)!;
  let target: Point;
  if (opts.at && typeof opts.at === "object") target = opts.at;
  else if (opts.at === "center") {
    const vp = e.viewport();
    target = { x: vp.x + vp.w / 2 - b.w / 2, y: vp.y + vp.h / 2 - b.h / 2 };
  } else target = e.store.size === 0 ? (() => {
    const vp = e.viewport();
    return { x: vp.x + vp.w / 2 - b.w / 2, y: vp.y + vp.h / 2 - b.h / 2 };
  })() : findFreeRect(e, b.w, b.h);

  const dx = target.x - b.x;
  const dy = target.y - b.y;
  const baseZ = e.store.nextZ();
  const ordered = [...src].sort((a, c) => a.z - c.z);
  const zOf = new Map(ordered.map((el, i) => [el.id, baseZ + i]));
  const placed = src.map((el): El => {
    if (el.type === "connector") {
      const c = el as ConnectorEl;
      return {
        ...c,
        x: c.x + dx,
        y: c.y + dy,
        points: c.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        routeSig: c.routeSig ? shiftSig(c.routeSig, dx, dy) : undefined,
        z: zOf.get(el.id)!,
      };
    }
    return { ...el, x: el.x + dx, y: el.y + dy, z: zOf.get(el.id)! };
  });
  e.store.putMany(placed);
  const now = performance.now();
  for (const el of placed) e.anim.set(el.id, now);
  const rect = { x: target.x, y: target.y, w: b.w, h: b.h };
  if (opts.select !== false) e.select(placed.map((x) => x.id), { expandGroup: false });
  if (opts.fit !== false) {
    const vp = e.viewport();
    const fullyVisible = rect.x >= vp.x && rect.y >= vp.y && rect.x + rect.w <= vp.x + vp.w && rect.y + rect.h <= vp.y + vp.h;
    if (!fullyVisible || rect.w * e.zoom < 160) e.fitRect(rect, 100, 1.2, true);
  }
  e.requestRender();
  return { ids: placed.map((x) => x.id), bounds: rect };
}

/** routeSig looks like "x,y>x,y:route"; shifting both endpoints keeps cached routes valid. */
function shiftSig(sig: string, dx: number, dy: number): string {
  const m = sig.match(/^(-?[\d.]+),(-?[\d.]+)>(-?[\d.]+),(-?[\d.]+):(.+)$/);
  if (!m) return sig;
  const r = (n: number) => Math.round(n * 2) / 2;
  return `${r(+m[1] + dx)},${r(+m[2] + dy)}>${r(+m[3] + dx)},${r(+m[4] + dy)}:${m[5]}`;
}

/* ---------------------------------------------------------------- insertion */

export async function insertImageFile(e: Engine, file: File, at?: Point) {
  if (e.readOnly) return;
  if (!file.type.startsWith("image/")) {
    e.toast("That file isn't an image", "error");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    e.toast("Images must be under 12 MB", "error");
    return;
  }
  try {
    const { blob, width, height } = await prepareImageFile(file);
    const src = e.imageUploader ? await e.imageUploader(blob, file.name) : await blobToDataUrl(blob);
    const maxSide = 520;
    const k = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.max(24, Math.round(width * k));
    const h = Math.max(24, Math.round(height * k));
    const c = at ?? e.screenToWorld({ x: e.width / 2, y: e.height / 2 });
    const el = createImage(src, { x: c.x - w / 2, y: c.y - h / 2, w, h }, e.store.nextZ());
    e.store.put(el);
    e.select([el.id]);
    e.anim.set(el.id, performance.now());
    e.requestRender();
  } catch (err) {
    e.toast(err instanceof Error ? err.message : "Could not add image", "error");
  }
}

export function insertIcon(e: Engine, key: string, label: string, at?: Point) {
  if (e.readOnly) return;
  const c = at ?? e.screenToWorld({ x: e.width / 2, y: e.height / 2 });
  const s = DEFAULT_SIZES.icon;
  const withLabel = { w: s.w + 28, h: s.h + 30 };
  const el = {
    id: newId("i"),
    type: "icon" as const,
    icon: key,
    label,
    x: c.x - withLabel.w / 2,
    y: c.y - withLabel.h / 2,
    w: withLabel.w,
    h: withLabel.h,
    z: e.store.nextZ(),
  };
  e.store.put(el);
  e.select([el.id]);
  e.anim.set(el.id, performance.now());
  e.requestRender();
}

/** Drops a service-style node card (icon tile + title) on the board. */
export function insertCardNode(e: Engine, key: string, label: string, at?: Point) {
  if (e.readOnly) return;
  const c = at ?? e.screenToWorld({ x: e.width / 2, y: e.height / 2 });
  const { w, h } = cardSize(label, undefined, true);
  const card = createCard({ x: c.x - w / 2, y: c.y - h / 2, w, h }, e.store.nextZ(), { icon: key, title: label });
  e.store.put(card);
  e.select([card.id]);
  e.anim.set(card.id, performance.now());
  e.requestRender();
}

/* ---------------------------------------------------------------- quick add */

/** Adds a sibling node on `side` of `srcId` joined by a connector (Tab / the "+" handles). */
export function quickAdd(e: Engine, srcId: string, side: Side, at?: Point) {
  const src = e.store.get(srcId);
  if (!src || e.readOnly) return;
  if (src.type === "connector" || src.type === "pen") return;
  const gap = 90;
  const v = sideVector(side);
  const w = src.w;
  const h = src.h;
  const cx = src.x + src.w / 2;
  const cy = src.y + src.h / 2;
  let nx = cx + v.x * (src.w / 2 + gap + w / 2) - w / 2;
  let ny = cy + v.y * (src.h / 2 + gap + h / 2) - h / 2;
  if (at) {
    nx = at.x - w / 2;
    ny = at.y - h / 2;
  }
  // slide perpendicular to the growth direction until the spot is free
  const others = e.store.list().filter((x) => x.type !== "connector" && x.type !== "frame" && x.type !== "pen").map((x) => e.geom.bounds(x));
  const free = (x: number, y: number) => !others.some((r) => rectsOverlap(inflate({ x, y, w, h }, 12), r));
  if (!at) {
    const step = (v.x !== 0 ? h : w) + 36;
    for (let i = 0; i < 12 && !free(nx, ny); i++) {
      const k = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
      const tx = v.x !== 0 ? nx : cx + v.x * (src.w / 2 + gap + w / 2) - w / 2 + k * step;
      const ty = v.x !== 0 ? cy + v.y * (src.h / 2 + gap + h / 2) - h / 2 + k * step : ny;
      if (free(tx, ty)) {
        nx = tx;
        ny = ty;
        break;
      }
    }
  }
  const z = e.store.nextZ();
  let node: El;
  if (src.type === "card") node = createCard({ x: nx, y: ny, w, h }, z + 1, { icon: src.icon, accent: src.accent, title: "New node" });
  else node = { ...src, id: newId(src.id.charAt(0)), x: nx, y: ny, z: z + 1, groupId: undefined, diagramId: src.diagramId, locked: undefined } as El;
  if (node.type === "shape") node = { ...node, text: "" };
  if (node.type === "sticky") node = { ...node, text: "" };
  if (node.type === "icon") node = { ...node, label: "New" };
  if (node.type === "table") node = { ...node, title: "New table" };
  const conn = createConnector({ x: cx, y: cy }, { x: nx + w / 2, y: ny + h / 2 }, e.style, z, {
    start: { id: src.id, side },
    end: { id: node.id, side: OPPOSITE[side] },
    stroke: src.type === "shape" || src.type === "frame" ? src.stroke : undefined,
    diagramId: src.diagramId,
  });
  e.store.begin();
  e.store.put(node);
  e.store.put(conn);
  e.store.end();
  e.anim.set(node.id, performance.now());
  e.select([node.id], { expandGroup: false });
  e.requestRender();
  const field = node.type === "card" ? "card" : node.type === "icon" ? "iconLabel" : node.type === "table" ? "title" : "text";
  e.startEditing(node.id, field, true);
}

export function sideFromKey(key: string): Side | null {
  switch (key) {
    case "ArrowUp":
      return "top";
    case "ArrowDown":
      return "bottom";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
  }
  return null;
}
