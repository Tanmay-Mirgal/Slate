import { boxBounds, rectsIntersect, unionRects } from "./geometry";
import { hitElement } from "./hit";
import { resolveConnector, type ConnectorGeom } from "./router";
import type { DocStore } from "./store";
import type { ConnectorEl, El, Point, Rect } from "./types";

interface Entry {
  el: ConnectorEl;
  startEl?: El;
  endEl?: El;
  geomVersion: number;
  geom: ConnectorGeom;
}

/**
 * Memoised connector routing. A connector is re-routed only when it, one of its endpoints, or
 * (for elbow routes) the surrounding obstacles changed. While `frozen` (during drags) obstacle
 * changes are ignored so only connectors attached to moving elements are recomputed.
 */
export class GeometryCache {
  private map = new Map<string, Entry>();
  frozen = false;

  constructor(private store: DocStore) {}

  connector(c: ConnectorEl): ConnectorGeom {
    const startEl = c.start ? this.store.get(c.start.id) : undefined;
    const endEl = c.end ? this.store.get(c.end.id) : undefined;
    const e = this.map.get(c.id);
    const usesObstacles = c.route === "elbow";
    if (
      e &&
      e.el === c &&
      e.startEl === startEl &&
      e.endEl === endEl &&
      (!usesObstacles || this.frozen || e.geomVersion === this.store.geomVersion)
    ) {
      return e.geom;
    }
    const geom = resolveConnector(c, this.store);
    this.map.set(c.id, { el: c, startEl, endEl, geomVersion: this.store.geomVersion, geom });
    if (this.map.size > this.store.size + 200) this.prune();
    return geom;
  }

  private prune() {
    for (const id of this.map.keys()) if (!this.store.get(id)) this.map.delete(id);
  }

  bounds(el: El): Rect {
    if (el.type === "connector") return this.connector(el).bounds;
    return boxBounds(el);
  }

  clear() {
    this.map.clear();
  }
}

export function selectionBounds(cache: GeometryCache, els: El[]): Rect | null {
  return unionRects(els.map((e) => cache.bounds(e)));
}

export interface PickOptions {
  zoom: number;
  /** Screen-space slop in CSS pixels. */
  slop?: number;
  outlineOnly?: boolean;
  exclude?: Set<string>;
  filter?: (el: El) => boolean;
}

/** Topmost element under a world point. */
export function pickTopmost(store: DocStore, cache: GeometryCache, p: Point, opts: PickOptions): El | null {
  const list = store.list();
  const tol = (opts.slop ?? 5) / opts.zoom;
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    if (opts.exclude?.has(el.id)) continue;
    if (opts.filter && !opts.filter(el)) continue;
    const b = cache.bounds(el);
    if (p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) continue;
    const geom = el.type === "connector" ? cache.connector(el) : undefined;
    if (hitElement(el, p, geom, { tol, outlineOnly: opts.outlineOnly })) return el;
  }
  return null;
}

/** All elements whose bounds intersect `rect`. When `contain` is set, only fully enclosed ones. */
export function elementsInRect(store: DocStore, cache: GeometryCache, rect: Rect, contain = false): El[] {
  const out: El[] = [];
  for (const el of store.list()) {
    const b = cache.bounds(el);
    if (contain) {
      if (b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h) out.push(el);
    } else if (rectsIntersect(b, rect)) out.push(el);
  }
  return out;
}

/** Expands a set of ids to include everything sharing a group. */
export function expandGroups(store: DocStore, ids: Iterable<string>): Set<string> {
  const out = new Set<string>(ids);
  const groups = new Set<string>();
  for (const id of out) {
    const g = store.get(id)?.groupId;
    if (g) groups.add(g);
  }
  if (groups.size) for (const el of store.els.values()) if (el.groupId && groups.has(el.groupId)) out.add(el.id);
  return out;
}

/** Elements fully inside a frame (they travel with it). */
export function frameChildren(store: DocStore, cache: GeometryCache, frame: El): El[] {
  if (frame.type !== "frame") return [];
  const rect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  return elementsInRect(store, cache, rect, true).filter((e) => e.id !== frame.id);
}
