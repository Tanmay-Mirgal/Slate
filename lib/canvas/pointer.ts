import {
  cloneElements,
  copySelection,
  deleteElements,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  insertIcon,
  insertImageFile,
  nudgeSelection,
  pasteElements,
  pasteImages,
  pasteText,
  quickAdd,
  reorder,
  serializeSelection,
  setLocked,
  sideFromKey,
  ungroupSelection,
} from "./commands";
import {
  createConnector,
  createFrame,
  createPen,
  createShape,
  createSticky,
  createText,
  DEFAULT_SIZES,
  normalizeRect,
  textSize,
} from "./create";
import type { Engine } from "./engine";
import { MAX_ZOOM, MIN_ZOOM } from "./constants";
import {
  angleSnap,
  boxBounds,
  clamp,
  dist,
  fromLocal,
  simplifyPolyline,
  snapValue,
  toLocal,
  unionRects,
  type Box,
} from "./geometry";
import { cursorForHandle, hitHandle, type HandleId, type ResizeHandle, HANDLE_NORM } from "./handles";
import { quickAddPoint, QUICK_ADD_RADIUS_PX } from "./render";
import { anchorFor } from "./router";
import { elementsInRect, expandGroups, frameChildren, pickTopmost } from "./scene";
import { snapEdges, snapMove } from "./snap";
import type { ConnectorEl, El, PenEl, Point, Rect, Side, ShapeKind, ToolId } from "./types";

const DRAG_THRESHOLD = 3;

type Gesture =
  | { t: "pan"; sx: number; sy: number; cam: { x: number; y: number } }
  | { t: "marquee"; start: Point; base: Set<string> }
  | {
      t: "move";
      start: Point;
      startScreen: Point;
      origin: Map<string, El>;
      started: boolean;
      dupe: boolean;
      clickId: string | null;
      shift: boolean;
    }
  | { t: "resize"; handle: ResizeHandle; box: Box; origin: Map<string, El>; started: boolean }
  | { t: "rotate"; id: string; center: Point; origin: El; offset: number }
  | { t: "draw"; kind: "shape" | "frame" | "sticky" | "text"; start: Point; startScreen: Point; moved: boolean }
  | { t: "connector"; el: ConnectorEl; startScreen: Point; from?: { id: string; side: Side } }
  | { t: "pen"; points: Point[]; highlighter: boolean }
  | { t: "erase"; hit: Set<string>; last: Point }
  | { t: "endpoint"; id: string; which: "start" | "end"; origin: ConnectorEl }
  | { t: "pinch" };

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export class PointerController {
  private g: Gesture | null = null;
  private pointers = new Map<number, Point>();
  private pinch: { dist: number; center: Point } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private e: Engine) {}

  /* -------------------------------------------------------------- binding */

  attach(host: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      host.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => host.removeEventListener(type, fn as EventListener, opts));
    };
    on("pointerdown", (ev) => this.onPointerDown(ev));
    on("pointermove", (ev) => this.onPointerMove(ev));
    on("pointerup", (ev) => this.onPointerUp(ev));
    on("pointercancel", (ev) => this.onPointerUp(ev, true));
    on("pointerleave", () => this.onPointerLeave());
    on("dblclick", (ev) => this.onDoubleClick(ev));
    on("wheel", (ev) => this.onWheel(ev), { passive: false });
    on("contextmenu", (ev) => this.onContextMenu(ev));
    on("dragover", (ev) => {
      if (ev.dataTransfer && (ev.dataTransfer.types.includes("Files") || ev.dataTransfer.types.some((t) => t.startsWith("application/x-slate")))) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }
    });
    on("drop", (ev) => this.onDrop(ev));

    const win = <K extends keyof WindowEventMap>(type: K, fn: (ev: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => window.removeEventListener(type, fn as EventListener));
    };
    win("keydown", (ev) => this.onKeyDown(ev));
    win("keyup", (ev) => this.onKeyUp(ev));
    win("blur", () => {
      this.e.spaceDown = false;
      this.e.updateCursor();
    });
    const doc = <K extends keyof DocumentEventMap>(type: K, fn: (ev: DocumentEventMap[K]) => void) => {
      document.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => document.removeEventListener(type, fn as EventListener));
    };
    doc("copy", (ev) => this.onCopy(ev, false));
    doc("cut", (ev) => this.onCopy(ev, true));
    doc("paste", (ev) => this.onPaste(ev));
    return () => this.detach();
  }

  detach() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
  }

  /* -------------------------------------------------------------- helpers */

  /** Events from the text editor / context menu (which live inside the host) must not drive the canvas. */
  private isUi(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest("[data-slate-ui]");
  }

  private local(ev: { clientX: number; clientY: number }): Point {
    const r = this.e.host!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private world(ev: { clientX: number; clientY: number }): Point {
    return this.e.screenToWorld(this.local(ev));
  }

  private gridPoint(p: Point): Point {
    const e = this.e;
    if (!e.view.snapToGrid) return p;
    const s = e.view.gridSize;
    return { x: snapValue(p.x, s), y: snapValue(p.y, s) };
  }

  private snapOptions() {
    const v = this.e.view;
    return { objects: v.snapToObjects, grid: v.snapToGrid, gridSize: v.gridSize };
  }

  private nearbyBounds(exclude: Set<string>): Rect[] {
    const e = this.e;
    const vp = e.viewport();
    const win = { x: vp.x - 200, y: vp.y - 200, w: vp.w + 400, h: vp.h + 400 };
    const out: Rect[] = [];
    for (const el of e.store.list()) {
      if (exclude.has(el.id) || el.type === "connector") continue;
      const b = e.geom.bounds(el);
      if (b.x > win.x + win.w || b.x + b.w < win.x || b.y > win.y + win.h || b.y + b.h < win.y) continue;
      out.push(b);
    }
    return out;
  }

  private pick(p: Point, opts: { exclude?: Set<string>; outlineOnly?: boolean; connectable?: boolean } = {}) {
    const e = this.e;
    return pickTopmost(e.store, e.geom, p, {
      zoom: e.zoom,
      slop: opts.outlineOnly ? 6 : 4,
      exclude: opts.exclude,
      outlineOnly: opts.outlineOnly,
      filter: opts.connectable ? (el) => el.type !== "connector" && el.type !== "pen" : undefined,
    });
  }

  private selectionBox(): { box: Box; rotatable: boolean; handles: boolean } | null {
    const e = this.e;
    if (e.selection.size === 0 || e.readOnly) return null;
    const els = e.selectedElements();
    if (els.length === 0) return null;
    if (els.length === 1) {
      const el = els[0];
      if (el.type === "connector") return null;
      return { box: { x: el.x, y: el.y, w: el.w, h: el.h, angle: el.angle }, rotatable: el.type !== "pen" && !el.locked, handles: !el.locked };
    }
    const b = unionRects(els.map((x) => e.geom.bounds(x)));
    if (!b) return null;
    return { box: b, rotatable: false, handles: !els.every((x) => x.locked) };
  }

  /* ------------------------------------------------------------ pointer down */

  private onPointerDown(ev: PointerEvent) {
    const e = this.e;
    if (!e.host || this.isUi(ev.target)) return;
    if (ev.button === 2) return; // context menu handled separately
    if (e.contextMenu) {
      e.contextMenu = null;
      e.scheduleUi();
    }
    if (e.editing) e.commitEditing();
    (document.activeElement as HTMLElement | null)?.blur?.();
    try {
      e.host.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const screen = this.local(ev);
    this.pointers.set(ev.pointerId, screen);

    if (this.pointers.size === 2) {
      this.cancelGesture();
      this.g = { t: "pinch" };
      const [a, b] = Array.from(this.pointers.values());
      this.pinch = { dist: dist(a, b), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (this.pointers.size > 2) return;

    ev.preventDefault();
    const p = e.screenToWorld(screen);

    // Panning: middle mouse, space, hand tool, or any drag in read-only mode.
    if (ev.button === 1 || e.spaceDown || e.tool === "hand" || e.readOnly) {
      this.g = { t: "pan", sx: screen.x, sy: screen.y, cam: { x: e.camera.x, y: e.camera.y } };
      e.updateCursor("grabbing");
      return;
    }

    switch (e.tool) {
      case "select":
        return this.downSelect(ev, p, screen);
      case "shape":
      case "frame":
      case "sticky":
      case "text": {
        const kind = e.tool;
        this.g = { t: "draw", kind, start: this.gridPoint(p), startScreen: screen, moved: false };
        return;
      }
      case "connector":
      case "line":
        return this.downConnector(p, screen);
      case "pen":
      case "highlighter":
        this.g = { t: "pen", points: [p], highlighter: e.tool === "highlighter" };
        e.interacting = true;
        e.draft = createPen([p, { x: p.x + 0.01, y: p.y + 0.01 }], e.style, e.store.nextZ(), e.tool === "highlighter");
        e.requestRender();
        return;
      case "eraser":
        this.g = { t: "erase", hit: new Set(), last: p };
        e.interacting = true;
        this.eraseAt(p);
        return;
      case "image":
        this.pickImage(p);
        return;
      case "icon":
        e.setTool("select");
        return;
    }
  }

  private pickImage(at: Point) {
    const e = this.e;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void insertImageFile(e, f, at);
    };
    input.click();
    e.finishTool();
    if (e.tool === "image") e.setTool("select");
  }

  private downSelect(ev: PointerEvent, p: Point, screen: Point) {
    const e = this.e;
    const sb = this.selectionBox();
    const shift = ev.shiftKey || ev.metaKey || ev.ctrlKey;

    // 1) handles on the current selection
    if (sb && sb.handles) {
      const h = hitHandle(sb.box, p, e.zoom, sb.rotatable);
      if (h) return this.beginHandle(h, sb.box, p);
    }
    // 2) quick-add "+" handles
    const qb = e.quickAddBox();
    if (qb) {
      for (const side of ["top", "right", "bottom", "left"] as Side[]) {
        const q = quickAddPoint(qb, side, e.zoom);
        if (dist(q, p) <= (QUICK_ADD_RADIUS_PX + 3) / e.zoom) {
          const el = e.store.get(Array.from(e.selection)[0])!;
          this.startConnectorFrom(el.id, side, screen);
          return;
        }
      }
    }
    // 3) endpoints of a selected connector
    if (e.selection.size === 1 && !e.readOnly) {
      const el = e.store.get(Array.from(e.selection)[0]);
      if (el?.type === "connector" && !el.locked) {
        const g = e.geom.connector(el);
        const r = 10 / e.zoom;
        if (dist(g.start, p) <= r) return this.beginEndpoint(el, "start");
        if (dist(g.end, p) <= r) return this.beginEndpoint(el, "end");
      }
    }
    // 4) elements
    const hit = this.pick(p);
    if (hit) {
      const insideEntered = !!hit.groupId && e.enteredGroup === hit.groupId;
      if (shift) {
        const next = new Set(e.selection);
        const ids = insideEntered ? [hit.id] : Array.from(expandGroups(e.store, [hit.id]));
        const removing = next.has(hit.id);
        for (const id of ids) {
          if (removing) next.delete(id);
          else next.add(id);
        }
        e.select(next, { expandGroup: false });
        return;
      }
      if (!e.selection.has(hit.id)) {
        if (!insideEntered && hit.groupId) e.enteredGroup = null;
        e.select([hit.id], { expandGroup: !insideEntered });
      }
      if (hit.locked) {
        this.g = { t: "marquee", start: p, base: new Set() };
        return;
      }
      const origin = new Map<string, El>();
      for (const el of e.selectedElements()) origin.set(el.id, el);
      this.g = { t: "move", start: p, startScreen: screen, origin, started: false, dupe: ev.altKey, clickId: hit.id, shift };
      return;
    }
    // 5) empty space: marquee
    const base = shift ? new Set(e.selection) : new Set<string>();
    if (!shift) {
      e.clearSelection();
      e.enteredGroup = null;
    }
    this.g = { t: "marquee", start: p, base };
    e.marquee = { x: p.x, y: p.y, w: 0, h: 0 };
  }

  private beginHandle(h: HandleId, box: Box, p: Point) {
    const e = this.e;
    const origin = new Map<string, El>();
    const ids = new Set(e.selection);
    for (const el of e.selectedElements()) if (el.type === "frame") for (const c of frameChildren(e.store, e.geom, el)) ids.add(c.id);
    for (const id of ids) {
      const el = e.store.get(id);
      if (el) origin.set(id, el);
    }
    if (h === "rotate") {
      const el = Array.from(origin.values())[0];
      const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
      const start = Math.atan2(p.y - center.y, p.x - center.x);
      this.g = { t: "rotate", id: el.id, center, origin: el, offset: (el.angle ?? 0) - start };
      e.interacting = true;
      e.store.begin();
      e.updateCursor("grabbing");
      return;
    }
    this.g = { t: "resize", handle: h, box, origin, started: false };
    e.interacting = true;
    e.store.begin();
    e.geom.frozen = true;
    e.updateCursor(cursorForHandle(h, box.angle));
  }

  private beginEndpoint(el: ConnectorEl, which: "start" | "end") {
    const e = this.e;
    this.g = { t: "endpoint", id: el.id, which, origin: el };
    e.interacting = true;
    e.store.begin();
    e.geom.frozen = true;
  }

  /* ---------------------------------------------------------------- connector */

  private bindingTarget(p: Point, exclude?: string): { id: string; side?: Side } | null {
    const e = this.e;
    const hit = this.pick(p, { connectable: true, exclude: exclude ? new Set([exclude]) : undefined });
    // also allow snapping when merely close to a node edge
    const el = hit ?? this.nearestNode(p, 18 / e.zoom, exclude);
    if (!el) return null;
    let side: Side | undefined;
    for (const s of ["top", "right", "bottom", "left"] as Side[]) {
      if (dist(anchorFor(el, s), p) <= 14 / e.zoom) side = s;
    }
    return { id: el.id, side };
  }

  private nearestNode(p: Point, within: number, exclude?: string): El | null {
    const e = this.e;
    let best: El | null = null;
    let bd = within;
    for (const el of e.store.list()) {
      if (el.id === exclude || el.type === "connector" || el.type === "pen") continue;
      const b = e.geom.bounds(el);
      const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
      const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d <= bd) {
        bd = d;
        best = el;
      }
    }
    return best;
  }

  private downConnector(p: Point, screen: Point) {
    const e = this.e;
    const target = this.bindingTarget(p);
    const el = createConnector(p, p, e.style, e.store.nextZ(), {
      ...(e.tool === "line" ? { route: "straight", startHead: "none", endHead: "none" } : {}),
      ...(target ? { start: { id: target.id, side: target.side } } : {}),
    });
    this.g = { t: "connector", el, startScreen: screen };
    e.interacting = true;
    e.draft = el;
    e.requestRender();
  }

  private startConnectorFrom(id: string, side: Side, screen: Point) {
    const e = this.e;
    const src = e.store.get(id)!;
    const a = anchorFor(src, side);
    const el = createConnector(a, a, e.style, e.store.nextZ(), { start: { id, side } });
    this.g = { t: "connector", el, startScreen: screen, from: { id, side } };
    e.interacting = true;
    e.draft = el;
    e.requestRender();
  }

  /* ------------------------------------------------------------- pointer move */

  private onPointerMove(ev: PointerEvent) {
    const e = this.e;
    if (!e.host) return;
    const screen = this.local(ev);
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, screen);
    const p = e.screenToWorld(screen);
    e.cursorWorld = p;
    e.schedulePresence();

    const g = this.g;
    if (!g) return this.hover(p);

    switch (g.t) {
      case "pinch":
        return this.movePinch();
      case "pan":
        e.setCamera({ ...e.camera, x: g.cam.x + (screen.x - g.sx), y: g.cam.y + (screen.y - g.sy) });
        return;
      case "marquee": {
        const r = normalizeRect(g.start, p);
        e.marquee = r;
        const hits = elementsInRect(e.store, e.geom, r);
        const next = new Set(g.base);
        for (const h of hits) next.add(h.id);
        // keep frames out of marquee unless fully enclosed so they don't swallow drags
        for (const h of hits) if (h.type === "frame") {
          const b = e.geom.bounds(h);
          if (!(b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h)) next.delete(h.id);
        }
        e.selection = expandGroups(e.store, next);
        e.requestRender();
        e.scheduleUi();
        return;
      }
      case "move":
        return this.moveSelection(g, p, screen, ev);
      case "resize":
        return this.moveResize(g, p, ev);
      case "rotate": {
        let a = Math.atan2(p.y - g.center.y, p.x - g.center.x) + g.offset;
        if (ev.shiftKey) a = angleSnap(a);
        e.store.patch(g.id, { angle: a % (Math.PI * 2) || undefined });
        return;
      }
      case "draw":
        return this.moveDraw(g, p, screen, ev);
      case "connector":
        return this.moveConnector(g, p, ev);
      case "pen": {
        const last = g.points[g.points.length - 1];
        if (dist(last, p) < 1.2 / e.zoom) return;
        g.points.push(p);
        e.draft = createPen(g.points, e.style, 0, g.highlighter);
        (e.draft as PenEl).id = "draft-pen";
        e.requestRender();
        e.schedulePresence();
        return;
      }
      case "erase":
        this.eraseLine(g.last, p);
        g.last = p;
        return;
      case "endpoint":
        return this.moveEndpoint(g, p);
    }
  }

  private hover(p: Point) {
    const e = this.e;
    if (e.spaceDown || e.tool === "hand") return e.updateCursor();
    if (e.tool === "select" && !e.readOnly) {
      const sb = this.selectionBox();
      if (sb && sb.handles) {
        const h = hitHandle(sb.box, p, e.zoom, sb.rotatable);
        if (h) {
          e.updateCursor(cursorForHandle(h, sb.box.angle));
          e.setHover(null);
          return;
        }
      }
      const qb = e.quickAddBox();
      let qh: Side | null = null;
      if (qb) {
        for (const side of ["top", "right", "bottom", "left"] as Side[]) {
          if (dist(quickAddPoint(qb, side, e.zoom), p) <= (QUICK_ADD_RADIUS_PX + 3) / e.zoom) qh = side;
        }
      }
      if (qh !== e.quickAddHover) {
        e.quickAddHover = qh;
        e.requestRender();
      }
      if (qh) {
        e.updateCursor("pointer");
        e.setHover(null);
        return;
      }
      if (e.selection.size === 1) {
        const el = e.store.get(Array.from(e.selection)[0]);
        if (el?.type === "connector" && !el.locked) {
          const g = e.geom.connector(el);
          if (dist(g.start, p) <= 10 / e.zoom || dist(g.end, p) <= 10 / e.zoom) {
            e.updateCursor("pointer");
            return;
          }
        }
      }
      const hit = this.pick(p);
      e.setHover(hit?.id ?? null);
      e.updateCursor(hit ? (e.selection.has(hit.id) ? "move" : "default") : "default");
    } else if (e.tool === "connector" || e.tool === "line") {
      const t = this.bindingTarget(p);
      e.anchorTargets = t ? [{ id: t.id, side: t.side }] : [];
      e.requestRender();
    } else if (e.tool === "eraser") {
      e.updateCursor("crosshair");
    }
  }

  private onPointerLeave() {
    const e = this.e;
    e.cursorWorld = null;
    e.schedulePresence();
    if (!this.g) {
      e.setHover(null);
      if (e.anchorTargets.length) {
        e.anchorTargets = [];
        e.requestRender();
      }
    }
  }

  private movePinch() {
    const e = this.e;
    if (this.pointers.size < 2 || !this.pinch) return;
    const [a, b] = Array.from(this.pointers.values());
    const d = dist(a, b);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const factor = d / Math.max(1, this.pinch.dist);
    const z0 = e.camera.zoom;
    const z1 = clamp(z0 * factor, MIN_ZOOM, MAX_ZOOM);
    const k = z1 / z0;
    // zoom around the previous centre, then follow the fingers as the centre moves
    const zx = this.pinch.center.x - (this.pinch.center.x - e.camera.x) * k;
    const zy = this.pinch.center.y - (this.pinch.center.y - e.camera.y) * k;
    e.setCamera({ zoom: z1, x: zx + (c.x - this.pinch.center.x), y: zy + (c.y - this.pinch.center.y) });
    this.pinch = { dist: d, center: c };
  }

  /* -------------------------------------------------------------------- move */

  private moveSelection(g: Extract<Gesture, { t: "move" }>, p: Point, screen: Point, ev: PointerEvent) {
    const e = this.e;
    if (!g.started) {
      if (dist(screen, g.startScreen) < DRAG_THRESHOLD) return;
      g.started = true;
      e.interacting = true;
      e.store.begin();
      e.geom.frozen = true;
      // frames carry what's inside them
      const ids = new Set(g.origin.keys());
      for (const el of Array.from(g.origin.values())) {
        if (el.type === "frame") for (const c of frameChildren(e.store, e.geom, el)) if (!ids.has(c.id)) {
          ids.add(c.id);
          g.origin.set(c.id, c);
        }
      }
      if (g.dupe) {
        const src = Array.from(g.origin.values());
        const { els } = cloneElements(e, src, { x: 0, y: 0 });
        e.store.putMany(els);
        g.origin = new Map(els.map((x) => [x.id, x]));
        e.selection = new Set(els.map((x) => x.id));
        e.scheduleUi();
      }
      e.updateCursor("grabbing");
      e.setHover(null);
    }
    let dx = p.x - g.start.x;
    let dy = p.y - g.start.y;
    if (ev.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const movable = Array.from(g.origin.values()).filter((el) => !el.locked);
    const movingBounds = unionRects(movable.map((el) => (el.type === "connector" ? e.geom.bounds(el) : boxBounds(el))));
    if (movingBounds && !ev.altKey) {
      const shifted = { x: movingBounds.x + dx, y: movingBounds.y + dy, w: movingBounds.w, h: movingBounds.h };
      const snap = snapMove(shifted, this.nearbyBounds(new Set(g.origin.keys())), e.zoom, this.snapOptions());
      dx += snap.dx;
      dy += snap.dy;
      e.guides = snap.guides;
    } else e.guides = [];

    e.store.patchMany(g.origin.keys(), (cur) => {
      const o = g.origin.get(cur.id)!;
      if (o.locked) return null;
      if (o.type === "connector") {
        if (o.start && o.end) return null;
        const pts = o.points.map((q, i) => {
          const last = i === o.points.length - 1;
          if ((i === 0 && o.start) || (last && o.end)) return q;
          return { x: q.x + dx, y: q.y + dy };
        });
        return { points: pts, x: o.x + dx, y: o.y + dy, routeSig: undefined } as Partial<El>;
      }
      return { x: o.x + dx, y: o.y + dy };
    });
    e.dragPreview = { ids: Array.from(g.origin.keys()).slice(0, 80), dx, dy };
    e.schedulePresence();
  }

  /* ------------------------------------------------------------------ resize */

  private moveResize(g: Extract<Gesture, { t: "resize" }>, p: Point, ev: PointerEvent) {
    const e = this.e;
    const { box, handle, origin } = g;
    const [nx, ny] = HANDLE_NORM[handle];
    const single = origin.size === 1 || (e.selection.size === 1 && origin.size >= 1);
    const first = single ? e.store.get(Array.from(e.selection)[0]) : null;
    const lockAspect =
      ev.shiftKey ||
      (!!first && (first.type === "image" || first.type === "icon") && nx !== 0.5 && ny !== 0.5) ||
      (!single && ev.shiftKey);

    let q = toLocal(box, p);
    // snap the moving edges (only for unrotated boxes)
    if (!box.angle) {
      const edgesX: number[] = [];
      const edgesY: number[] = [];
      if (nx === 0) edgesX.push(p.x);
      if (nx === 1) edgesX.push(p.x);
      if (ny === 0) edgesY.push(p.y);
      if (ny === 1) edgesY.push(p.y);
      const snap = snapEdges(edgesX, edgesY, box, this.nearbyBounds(new Set(origin.keys())), e.zoom, this.snapOptions());
      q = { x: q.x + snap.dx, y: q.y + snap.dy };
      e.guides = snap.guides;
    }
    const w0 = Math.max(1, box.w);
    const h0 = Math.max(1, box.h);
    const fromCenter = ev.altKey;
    let w1 = w0;
    let h1 = h0;
    if (nx === 0) w1 = fromCenter ? w0 - 2 * q.x : w0 - q.x;
    if (nx === 1) w1 = fromCenter ? 2 * q.x - w0 : q.x;
    if (ny === 0) h1 = fromCenter ? h0 - 2 * q.y : h0 - q.y;
    if (ny === 1) h1 = fromCenter ? 2 * q.y - h0 : q.y;
    const MIN = 8;
    if (lockAspect) {
      const s = nx === 0.5 ? h1 / h0 : ny === 0.5 ? w1 / w0 : Math.max(w1 / w0, h1 / h0);
      w1 = w0 * s;
      h1 = h0 * s;
    }
    w1 = Math.max(MIN, w1);
    h1 = Math.max(MIN, h1);
    // new box expressed in the old box's local frame
    let left = 0;
    let top = 0;
    if (fromCenter) {
      left = (w0 - w1) / 2;
      top = (h0 - h1) / 2;
    } else {
      if (nx === 0) left = w0 - w1;
      if (ny === 0) top = h0 - h1;
    }
    const centerWorld = fromLocal(box, { x: left + w1 / 2, y: top + h1 / 2 });
    const nb = { x: centerWorld.x - w1 / 2, y: centerWorld.y - h1 / 2, w: w1, h: h1 };
    const sx = w1 / w0;
    const sy = h1 / h0;

    if (single && first) {
      const o = origin.get(first.id)!;
      const patch: Record<string, unknown> = { x: nb.x, y: nb.y, w: nb.w, h: nb.h };
      if (o.type === "text") {
        const corner = nx !== 0.5 && ny !== 0.5;
        if (corner) {
          const fs = clamp(Math.round(o.fontSize * Math.max(sx, sy)), 8, 400);
          const sz = textSize(o.text, { ...o, fontSize: fs }, o.autoW ? undefined : nb.w);
          patch.fontSize = fs;
          patch.w = o.autoW ? sz.w : nb.w;
          patch.h = sz.h;
        } else {
          const sz = textSize(o.text, o, nb.w);
          patch.autoW = false;
          patch.w = nb.w;
          patch.h = Math.max(sz.h, o.fontSize * 1.3);
          patch.x = nb.x;
        }
      } else if (o.type === "pen") {
        const pts = o.pts.slice();
        for (let i = 0; i + 1 < pts.length; i += 2) {
          pts[i] = o.pts[i] * sx;
          pts[i + 1] = o.pts[i + 1] * sy;
        }
        patch.pts = pts;
      } else if (o.type === "shape" || o.type === "card" || o.type === "table") {
        patch.h = o.type === "table" ? Math.max(nb.h, 40) : nb.h;
      }
      e.store.patch(first.id, patch as Partial<El>);
      return;
    }

    // multi-selection: scale every member about the opposite corner of the union box
    const anchorX = box.x + (nx === 0 ? w0 : nx === 1 ? 0 : w0 / 2);
    const anchorY = box.y + (ny === 0 ? h0 : ny === 1 ? 0 : h0 / 2);
    const ax = fromCenter ? box.x + w0 / 2 : anchorX;
    const ay = fromCenter ? box.y + h0 / 2 : anchorY;
    const usx = nx === 0.5 ? 1 : sx;
    const usy = ny === 0.5 ? 1 : sy;
    e.store.patchMany(origin.keys(), (cur) => {
      const o = origin.get(cur.id)!;
      if (o.locked) return null;
      if (o.type === "connector") {
        if (o.start && o.end) return null;
        const pts = o.points.map((pt, i) => {
          const last = i === o.points.length - 1;
          if ((i === 0 && o.start) || (last && o.end)) return pt;
          return { x: ax + (pt.x - ax) * usx, y: ay + (pt.y - ay) * usy };
        });
        return { points: pts, routeSig: undefined } as Partial<El>;
      }
      const patch: Record<string, unknown> = {
        x: ax + (o.x - ax) * usx,
        y: ay + (o.y - ay) * usy,
        w: Math.max(2, o.w * usx),
        h: Math.max(2, o.h * usy),
      };
      if (o.type === "text") {
        const fs = clamp(Math.round(o.fontSize * Math.min(usx, usy)), 8, 400);
        const sz = textSize(o.text, { ...o, fontSize: fs }, o.autoW ? undefined : (patch.w as number));
        patch.fontSize = fs;
        patch.w = o.autoW ? sz.w : patch.w;
        patch.h = sz.h;
      } else if (o.type === "pen") {
        const pts = o.pts.slice();
        for (let i = 0; i + 1 < pts.length; i += 2) {
          pts[i] = o.pts[i] * usx;
          pts[i + 1] = o.pts[i + 1] * usy;
        }
        patch.pts = pts;
      }
      return patch as Partial<El>;
    });
  }

  /* -------------------------------------------------------------------- draw */

  private moveDraw(g: Extract<Gesture, { t: "draw" }>, p: Point, screen: Point, ev: PointerEvent) {
    const e = this.e;
    if (!g.moved) {
      if (dist(screen, g.startScreen) < 4) return;
      g.moved = true;
      e.interacting = true;
    }
    const end = this.gridPoint(p);
    let rect: Rect;
    if (ev.altKey) {
      const dx = Math.abs(end.x - g.start.x);
      const dy = Math.abs(end.y - g.start.y);
      rect = { x: g.start.x - dx, y: g.start.y - dy, w: dx * 2, h: dy * 2 };
    } else rect = normalizeRect(g.start, end);
    if (ev.shiftKey && g.kind !== "text") {
      const s = Math.max(rect.w, rect.h);
      rect = { x: end.x < g.start.x ? g.start.x - s : g.start.x, y: end.y < g.start.y ? g.start.y - s : g.start.y, w: s, h: s };
    }
    const z = e.store.nextZ();
    if (g.kind === "shape") e.draft = createShape(e.shapeKind, rect, e.style, z);
    else if (g.kind === "frame") e.draft = createFrame(rect, e.store.minZ() - 1);
    else if (g.kind === "sticky") e.draft = createSticky(rect, e.style, z);
    else {
      const t = createText({ x: rect.x, y: rect.y }, e.style, z);
      e.draft = { ...t, w: Math.max(40, rect.w), h: Math.max(t.h, rect.h), autoW: false, align: "left" };
    }
    e.requestRender();
    e.schedulePresence();
  }

  /* ---------------------------------------------------------------- connector */

  private moveConnector(g: Extract<Gesture, { t: "connector" }>, p: Point, ev: PointerEvent) {
    const e = this.e;
    const startId = g.el.start?.id;
    const target = this.bindingTarget(p, g.from ? g.from.id : undefined) ?? null;
    let end = p;
    if (target) {
      const el = e.store.get(target.id)!;
      end = target.side ? anchorFor(el, target.side) : p;
      e.anchorTargets = [{ id: target.id, side: target.side }];
    } else e.anchorTargets = [];
    // keep the start anchor in sync when started free
    const startPt = g.el.points[0];
    if (ev.shiftKey && !target) {
      const dx = end.x - startPt.x;
      const dy = end.y - startPt.y;
      const a = angleSnap(Math.atan2(dy, dx), Math.PI / 4);
      const r = Math.hypot(dx, dy);
      end = { x: startPt.x + Math.cos(a) * r, y: startPt.y + Math.sin(a) * r };
    }
    const next: ConnectorEl = {
      ...g.el,
      points: [startPt, end],
      x: Math.min(startPt.x, end.x),
      y: Math.min(startPt.y, end.y),
      w: Math.abs(startPt.x - end.x),
      h: Math.abs(startPt.y - end.y),
      end: target ? { id: target.id, side: target.side } : undefined,
    };
    if (startId && target && target.id === startId && !target.side && !g.from) next.end = undefined;
    g.el = next;
    e.draft = next;
    e.requestRender();
    e.schedulePresence();
  }

  private moveEndpoint(g: Extract<Gesture, { t: "endpoint" }>, p: Point) {
    const e = this.e;
    const cur = e.store.get(g.id) as ConnectorEl | undefined;
    if (!cur) return;
    const target = this.bindingTarget(p, undefined);
    let pt = p;
    let binding: ConnectorEl["start"] = undefined;
    if (target) {
      const el = e.store.get(target.id)!;
      binding = { id: target.id, side: target.side };
      pt = target.side ? anchorFor(el, target.side) : p;
      e.anchorTargets = [{ id: target.id, side: target.side }];
    } else e.anchorTargets = [];
    const points = cur.points.length >= 2 ? cur.points.slice() : [cur.points[0] ?? p, p];
    if (g.which === "start") points[0] = pt;
    else points[points.length - 1] = pt;
    e.store.patch(g.id, {
      points,
      ...(g.which === "start" ? { start: binding } : { end: binding }),
      routeSig: undefined,
    } as Partial<El>);
  }

  /* -------------------------------------------------------------------- erase */

  private eraseAt(p: Point) {
    const e = this.e;
    const g = this.g;
    if (!g || g.t !== "erase") return;
    for (let guard = 0; guard < 6; guard++) {
      const hit = this.pick(p, { exclude: g.hit, outlineOnly: true });
      if (!hit || hit.locked) break;
      g.hit.add(hit.id);
    }
    e.fading = new Set(g.hit);
    e.requestRender();
  }

  private eraseLine(a: Point, b: Point) {
    const e = this.e;
    const step = 4 / e.zoom;
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let i = 1; i <= n; i++) {
      this.eraseAt({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
    }
  }

  /* ---------------------------------------------------------------- pointer up */

  private onPointerUp(ev: PointerEvent, cancelled = false) {
    const e = this.e;
    try {
      e.host?.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    this.pointers.delete(ev.pointerId);
    const g = this.g;
    if (!g) return;
    if (g.t === "pinch") {
      if (this.pointers.size < 2) {
        this.g = null;
        this.pinch = null;
      }
      return;
    }
    if (cancelled) {
      this.cancelGesture();
      return;
    }
    const p = this.world(ev);
    this.g = null;
    e.interacting = false;
    e.geom.frozen = false;
    e.guides = [];
    e.anchorTargets = [];

    switch (g.t) {
      case "pan":
        e.updateCursor();
        break;
      case "marquee":
        e.marquee = null;
        e.requestRender();
        e.scheduleUi();
        break;
      case "move": {
        if (g.started) {
          e.store.end();
          e.dragPreview = null;
          e.schedulePresence();
        } else if (g.clickId && !g.shift) {
          // plain click on an element inside a multi-selection narrows to it
          const insideEntered = e.enteredGroup && e.store.get(g.clickId)?.groupId === e.enteredGroup;
          if (e.selection.size > 1 && !insideEntered && !e.store.get(g.clickId)?.groupId) e.select([g.clickId]);
        }
        e.updateCursor();
        break;
      }
      case "resize":
        e.store.end();
        e.updateCursor();
        break;
      case "rotate":
        e.store.end();
        e.updateCursor();
        break;
      case "endpoint":
        e.store.end();
        break;
      case "draw":
        this.finishDraw(g);
        break;
      case "connector":
        this.finishConnector(g, p);
        break;
      case "pen":
        this.finishPen(g);
        break;
      case "erase": {
        const ids = Array.from(g.hit);
        e.fading = new Set();
        if (ids.length) deleteElements(e, ids);
        e.requestRender();
        break;
      }
    }
    e.scheduleUi();
    e.requestRender();
  }

  private finishDraw(g: Extract<Gesture, { t: "draw" }>) {
    const e = this.e;
    const draft = e.draft;
    e.draft = null;
    const z = e.store.nextZ();
    let el: El | null = null;
    if (g.moved && draft && draft.w >= 6 && draft.h >= 6) {
      el = draft.type === "text" ? { ...draft, z } : draft.type === "frame" ? draft : { ...draft, z };
    } else if (g.moved && draft && g.kind === "text" && draft.w >= 6) {
      el = { ...draft, z };
    } else {
      // single click: drop a default sized element centred on the pointer
      const c = this.gridPoint(g.start);
      if (g.kind === "text") {
        el = createText(c, e.style, z);
      } else if (g.kind === "shape") {
        const s = DEFAULT_SIZES[e.shapeKind] ?? DEFAULT_SIZES.rect;
        el = createShape(e.shapeKind, { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, e.style, z);
      } else if (g.kind === "sticky") {
        const s = DEFAULT_SIZES.sticky;
        el = createSticky({ x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, e.style, z);
      } else {
        const s = DEFAULT_SIZES.frame;
        el = createFrame({ x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, e.store.minZ() - 1);
      }
    }
    if (!el) return;
    const created = el;
    // Leave the drawing tool first: switching tools commits any open text edit.
    e.finishTool();
    if (created.type === "text") {
      // create + first edit are a single undo step
      e.store.begin();
      e.store.put(created);
      e.startEditing(created.id, "text", true);
      e.store.end();
      return;
    }
    e.store.put(created);
    e.anim.set(created.id, performance.now());
    e.select([created.id], { expandGroup: false });
    if (created.type === "shape" || created.type === "sticky") e.startEditing(created.id, "text", true);
    else if (created.type === "frame") e.startEditing(created.id, "title", true);
  }

  private finishConnector(g: Extract<Gesture, { t: "connector" }>, p: Point) {
    const e = this.e;
    e.draft = null;
    const el = g.el;
    const length = dist(el.points[0], el.points[el.points.length - 1]);
    const hasEnd = !!el.end;
    if (length < 8 / e.zoom && !hasEnd) {
      if (g.from) {
        // a click on a "+" handle adds a sibling node
        quickAdd(e, g.from.id, g.from.side);
        return;
      }
      e.requestRender();
      return;
    }
    // Dragging from a "+" handle into empty space creates the next node right there.
    if (g.from && !hasEnd && e.store.get(g.from.id)) {
      quickAdd(e, g.from.id, g.from.side, this.gridPoint(p));
      return;
    }
    const final: ConnectorEl = { ...el, z: e.store.nextZ() };
    e.store.put(final);
    e.anim.set(final.id, performance.now());
    e.select([final.id], { expandGroup: false });
    e.finishTool();
  }

  private finishPen(g: Extract<Gesture, { t: "pen" }>) {
    const e = this.e;
    e.draft = null;
    let pts = g.points;
    if (pts.length === 1) pts = [pts[0], { x: pts[0].x + 0.01, y: pts[0].y + 0.01 }];
    else if (pts.length > 3) pts = simplifyPolyline(pts, 0.35 / e.zoom);
    const el = createPen(pts, e.style, e.store.nextZ(), g.highlighter);
    e.store.put(el);
    e.anim.delete(el.id);
    e.requestRender();
  }

  /** Aborts the current gesture and restores the pre-gesture state. */
  cancelGesture() {
    const e = this.e;
    const g = this.g;
    this.g = null;
    e.interacting = false;
    e.geom.frozen = false;
    e.guides = [];
    e.anchorTargets = [];
    e.marquee = null;
    e.draft = null;
    e.fading = new Set();
    e.dragPreview = null;
    if (g) {
      if (g.t === "move" && g.started) {
        for (const o of g.origin.values()) e.store.put(o);
        e.store.end();
      } else if (g.t === "resize") {
        for (const o of g.origin.values()) e.store.put(o);
        e.store.end();
      } else if (g.t === "rotate") {
        e.store.put(g.origin);
        e.store.end();
      } else if (g.t === "endpoint") {
        e.store.put(g.origin);
        e.store.end();
      }
    }
    e.updateCursor();
    e.requestRender();
    e.scheduleUi();
  }

  /* ------------------------------------------------------------ double click */

  private onDoubleClick(ev: MouseEvent) {
    const e = this.e;
    if (e.readOnly || !e.host || this.isUi(ev.target)) return;
    if (e.tool !== "select") return;
    const p = this.world(ev);
    const hit = this.pick(p);
    if (hit) {
      if (hit.groupId && e.enteredGroup !== hit.groupId && !hit.locked) {
        e.enteredGroup = hit.groupId;
        e.select([hit.id], { expandGroup: false });
        return;
      }
      if (hit.locked) return;
      switch (hit.type) {
        case "shape":
        case "sticky":
        case "text":
          return e.startEditing(hit.id, "text");
        case "card":
          return e.startEditing(hit.id, "card");
        case "frame":
        case "table":
          return e.startEditing(hit.id, "title");
        case "connector":
          return e.startEditing(hit.id, "label");
        case "icon":
          return e.startEditing(hit.id, "iconLabel");
        default:
          return;
      }
    }
    // double click on empty space creates a text box, like Eraser / Excalidraw
    const t = createText(this.gridPoint(p), e.style, e.store.nextZ());
    e.store.begin();
    e.store.put(t);
    e.startEditing(t.id, "text", true);
    e.store.end();
  }

  /* ------------------------------------------------------------------- wheel */

  private onWheel(ev: WheelEvent) {
    const e = this.e;
    if (!e.host || this.isUi(ev.target)) return;
    ev.preventDefault();
    const screen = this.local(ev);
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const dx = ev.deltaX * unit;
    const dy = ev.deltaY * unit;
    if (ev.ctrlKey || ev.metaKey) {
      const amount = clamp(-dy * 0.0105, -0.3, 0.3);
      e.zoomAt(screen, Math.exp(amount));
      return;
    }
    if (ev.shiftKey && Math.abs(dx) < 1) e.panBy(-dy, 0);
    else e.panBy(-dx, -dy);
  }

  /* ------------------------------------------------------------ context menu */

  private onContextMenu(ev: MouseEvent) {
    const e = this.e;
    ev.preventDefault();
    if (!e.host || this.isUi(ev.target)) return;
    if (e.readOnly) return;
    const p = this.world(ev);
    const hit = e.tool === "select" ? this.pick(p) : null;
    if (hit && !e.selection.has(hit.id)) e.select([hit.id]);
    if (!hit && e.tool === "select") e.clearSelection();
    const r = e.host.getBoundingClientRect();
    e.contextMenu = { x: ev.clientX - r.left, y: ev.clientY - r.top, target: hit?.id ?? null };
    e.scheduleUi();
  }

  /* -------------------------------------------------------------------- drop */

  private onDrop(ev: DragEvent) {
    const e = this.e;
    ev.preventDefault();
    if (e.readOnly || !ev.dataTransfer) return;
    const p = this.world(ev);
    const dt = ev.dataTransfer;
    const icon = dt.getData("application/x-slate-icon");
    if (icon) {
      try {
        const { key, label } = JSON.parse(icon) as { key: string; label: string };
        insertIcon(e, key, label, p);
      } catch {
        /* ignore */
      }
      return;
    }
    const shape = dt.getData("application/x-slate-shape");
    if (shape) {
      const kind = shape as ShapeKind;
      const s = DEFAULT_SIZES[kind] ?? DEFAULT_SIZES.rect;
      const el = createShape(kind, { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h }, e.style, e.store.nextZ());
      e.store.put(el);
      e.select([el.id]);
      e.startEditing(el.id, "text", true);
      return;
    }
    const files = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) void pasteImages(e, files, p);
  }

  /* ---------------------------------------------------------------- keyboard */

  private onKeyDown(ev: KeyboardEvent) {
    const e = this.e;
    if (isTypingTarget(ev.target) || e.editing) return;
    if (!e.host) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key;
    const lower = key.toLowerCase();

    if (key === " " && !ev.repeat) {
      e.spaceDown = true;
      e.updateCursor();
      e.scheduleUi();
      ev.preventDefault();
      return;
    }
    if (key === "Escape") {
      if (this.g) this.cancelGesture();
      else if (e.contextMenu) {
        e.contextMenu = null;
        e.scheduleUi();
      } else if (e.selection.size) e.clearSelection();
      else if (e.tool !== "select") e.setTool("select");
      return;
    }

    if (mod) {
      switch (lower) {
        case "z":
          ev.preventDefault();
          if (e.readOnly) return;
          this.undoRedo(ev.shiftKey ? "redo" : "undo");
          return;
        case "y":
          ev.preventDefault();
          if (!e.readOnly) this.undoRedo("redo");
          return;
        case "a":
          ev.preventDefault();
          e.setTool("select");
          e.selectAll();
          return;
        case "d":
          ev.preventDefault();
          duplicateSelection(e);
          return;
        case "g":
          ev.preventDefault();
          if (ev.shiftKey) ungroupSelection(e);
          else groupSelection(e);
          return;
        case "l":
          ev.preventDefault();
          setLocked(e, !e.selectedElements().every((x) => x.locked));
          return;
        case "]":
          ev.preventDefault();
          reorder(e, ev.shiftKey ? "front" : "forward");
          return;
        case "[":
          ev.preventDefault();
          reorder(e, ev.shiftKey ? "back" : "backward");
          return;
        case "0":
          ev.preventDefault();
          e.zoomTo(1);
          return;
        case "=":
        case "+":
          ev.preventDefault();
          e.zoomBy(1.25);
          return;
        case "-":
          ev.preventDefault();
          e.zoomBy(0.8);
          return;
        case "'":
          ev.preventDefault();
          e.setView({ grid: e.view.grid === "none" ? "dots" : "none" });
          return;
      }
      return; // let ctrl+c / ctrl+v / ctrl+k etc. reach the browser or other handlers
    }

    if (key === "Delete" || key === "Backspace") {
      if (e.selection.size) {
        ev.preventDefault();
        deleteSelection(e);
      }
      return;
    }
    if (key.startsWith("Arrow")) {
      ev.preventDefault();
      if (ev.altKey) {
        const side = sideFromKey(key);
        if (side && e.selection.size === 1) quickAdd(e, Array.from(e.selection)[0], side);
        return;
      }
      if (e.selection.size === 0) {
        const step = ev.shiftKey ? 120 : 40;
        e.panBy(key === "ArrowLeft" ? step : key === "ArrowRight" ? -step : 0, key === "ArrowUp" ? step : key === "ArrowDown" ? -step : 0);
        return;
      }
      const step = ev.shiftKey ? 10 : e.view.snapToGrid ? e.view.gridSize : 1;
      nudgeSelection(e, key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0, key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0);
      return;
    }
    if (key === "Enter" && e.selection.size === 1 && !e.readOnly) {
      const el = e.store.get(Array.from(e.selection)[0]);
      if (el && !el.locked) {
        ev.preventDefault();
        const field = el.type === "card" ? "card" : el.type === "frame" || el.type === "table" ? "title" : el.type === "connector" ? "label" : el.type === "icon" ? "iconLabel" : "text";
        if (el.type !== "image" && el.type !== "pen") e.startEditing(el.id, field);
      }
      return;
    }
    if (key === "Tab" && e.selection.size === 1 && !e.readOnly) {
      ev.preventDefault();
      quickAdd(e, Array.from(e.selection)[0], ev.shiftKey ? "top" : "bottom");
      return;
    }
    if (key === "+" || key === "=") return e.zoomBy(1.2);
    if (key === "-" || key === "_") return e.zoomBy(1 / 1.2);
    if (ev.shiftKey && key === "!") return e.fitContent();
    if (ev.shiftKey && key === "@") return e.fitSelection();
    if (ev.shiftKey && key === ")") return e.zoomTo(1);

    const tools: Record<string, [ToolId, ShapeKind?]> = {
      v: ["select"],
      h: ["hand"],
      r: ["shape", "rect"],
      o: ["shape", "ellipse"],
      d: ["shape", "diamond"],
      a: ["connector"],
      l: ["line"],
      p: [ev.shiftKey ? "highlighter" : "pen"],
      t: ["text"],
      n: ["sticky"],
      f: ["frame"],
      i: ["image"],
      e: ["eraser"],
    };
    const t = tools[lower];
    if (t && !ev.altKey) {
      if (e.readOnly && t[0] !== "hand" && t[0] !== "select") return;
      e.setTool(t[0], { shape: t[1], lock: ev.shiftKey && t[0] !== "highlighter" ? e.toolLocked : false });
    }
  }

  private undoRedo(kind: "undo" | "redo") {
    const e = this.e;
    if (this.g) this.cancelGesture();
    if (kind === "undo") e.undo();
    else e.redo();
  }

  private onKeyUp(ev: KeyboardEvent) {
    const e = this.e;
    if (ev.key === " ") {
      e.spaceDown = false;
      e.updateCursor();
      e.scheduleUi();
    }
  }

  /* --------------------------------------------------------------- clipboard */

  private onCopy(ev: ClipboardEvent, cut: boolean) {
    const e = this.e;
    if (isTypingTarget(ev.target) || e.editing || !e.host) return;
    if (e.selection.size === 0) return;
    ev.preventDefault();
    const payload = serializeSelection(e);
    e.clipboardMemo = JSON.parse(payload).elements;
    ev.clipboardData?.setData("text/plain", payload);
    if (cut && !e.readOnly) deleteSelection(e);
    else if (!cut) void copySelection(e);
  }

  private onPaste(ev: ClipboardEvent) {
    const e = this.e;
    if (isTypingTarget(ev.target) || e.editing || !e.host || e.readOnly) return;
    const cd = ev.clipboardData;
    if (!cd) return;
    ev.preventDefault();
    const files = Array.from(cd.files).filter((f) => f.type.startsWith("image/"));
    const at = e.cursorWorld ?? undefined;
    if (files.length) {
      void pasteImages(e, files, at);
      return;
    }
    const text = cd.getData("text/plain");
    if (text) {
      void pasteText(e, text, at);
      return;
    }
    if (e.clipboardMemo.length) pasteElements(e, e.clipboardMemo, at);
  }
}
