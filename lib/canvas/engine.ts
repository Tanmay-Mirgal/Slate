import { clamp, unionRects, type Box } from "./geometry";
import { DEFAULT_STYLE, textSize, type StyleDefaults } from "./create";
import { renderScene, type Guide, type RenderState } from "./render";
import { elementsInRect, expandGroups, GeometryCache, selectionBounds } from "./scene";
import { cameraAfterResize } from "./split";
import { ensureFonts } from "./text";
import { DocStore, type SyncState } from "./store";
import { THEMES } from "./theme";
import type {
  Camera,
  ConnectorEl,
  El,
  LocalPresence,
  Op,
  Peer,
  Point,
  Rect,
  Side,
  ShapeKind,
  ToolId,
  ViewSettings,
} from "./types";

import { MAX_ZOOM, MIN_ZOOM } from "./constants";
export { MAX_ZOOM, MIN_ZOOM };

/** Speech-bubble cursor for the Comment tool; its tip (the pin's anchor) is the hot spot. */
const COMMENT_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 25V12a9 9 0 0 1 9-9h4a9 9 0 0 1 0 18H9z" fill="#6366f1" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>'
)}") 3 25, crosshair`;

export type EditField = "text" | "title" | "label" | "card" | "iconLabel";

export interface EditingState {
  id: string;
  field: EditField;
  value: string;
  isNew: boolean;
}

export interface SelectionInfo {
  count: number;
  types: string[];
  stroke: string | "mixed" | null;
  fill: string | "mixed" | null;
  strokeWidth: number | "mixed" | null;
  dash: string | "mixed" | null;
  opacity: number | null;
  fontSize: number | "mixed" | null;
  font: string | "mixed" | null;
  align: string | "mixed" | null;
  route: string | "mixed" | null;
  startHead: string | "mixed" | null;
  endHead: string | "mixed" | null;
  textColor: string | "mixed" | null;
  locked: boolean;
  grouped: boolean;
  canFill: boolean;
  canStroke: boolean;
  hasText: boolean;
  hasConnector: boolean;
  hasRadius: boolean;
  radius: number | null;
}

export interface PeerInfo {
  sessionId: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
}

export interface UiState {
  tool: ToolId;
  toolLocked: boolean;
  shapeKind: ShapeKind;
  selection: string[];
  selectionInfo: SelectionInfo;
  zoomPct: number;
  canUndo: boolean;
  canRedo: boolean;
  readOnly: boolean;
  view: ViewSettings;
  style: StyleDefaults;
  editing: EditingState | null;
  sync: SyncState;
  syncError: string | null;
  peers: PeerInfo[];
  elementCount: number;
  spaceDown: boolean;
  cursor: string;
  contextMenu: { x: number; y: number; target: string | null } | null;
  /** Bumped whenever something that affects floating UI positions changes. */
  quickAdd: { id: string; box: Box } | null;
  /** The signed-in user may drop comment pins (the Comment tool is usable even on a read-only board). */
  commentsEnabled: boolean;
}

export const DEFAULT_VIEW: ViewSettings = {
  theme: "dark",
  grid: "dots",
  snapToGrid: false,
  snapToObjects: true,
  gridSize: 24,
};

const EMPTY_INFO: SelectionInfo = {
  count: 0,
  types: [],
  stroke: null,
  fill: null,
  strokeWidth: null,
  dash: null,
  opacity: null,
  fontSize: null,
  font: null,
  align: null,
  route: null,
  startHead: null,
  endHead: null,
  textColor: null,
  locked: false,
  grouped: false,
  canFill: false,
  canStroke: false,
  hasText: false,
  hasConnector: false,
  hasRadius: false,
  radius: null,
};

function common<T>(values: (T | undefined)[]): T | "mixed" | null {
  if (values.length === 0) return null;
  const first = values[0];
  for (const v of values) if (v !== first) return "mixed";
  return first === undefined ? null : first;
}

export function summarize(els: El[]): SelectionInfo {
  if (els.length === 0) return EMPTY_INFO;
  const fillable = els.filter((e) => e.type === "shape" || e.type === "frame" || e.type === "sticky" || e.type === "card" || e.type === "table");
  const stroked = els.filter((e) => e.type !== "image" && e.type !== "sticky" && e.type !== "icon");
  const texty = els.filter((e) => e.type === "shape" || e.type === "text" || e.type === "sticky" || e.type === "connector");
  const connectors = els.filter((e): e is ConnectorEl => e.type === "connector");
  const shapes = els.filter((e) => e.type === "shape");
  return {
    count: els.length,
    types: Array.from(new Set(els.map((e) => e.type))),
    stroke: common(stroked.map((e) => e.stroke ?? "ink")),
    fill: common(fillable.map((e) => (e.type === "sticky" ? e.fill : e.fill ?? "transparent"))),
    strokeWidth: common(stroked.map((e) => e.strokeWidth ?? 2)),
    dash: common(stroked.map((e) => e.dash ?? "solid")),
    opacity: els.every((e) => (e.opacity ?? 1) === (els[0].opacity ?? 1)) ? els[0].opacity ?? 1 : null,
    fontSize: common(texty.map((e) => (e.type === "connector" ? e.fontSize ?? 12 : "fontSize" in e ? e.fontSize ?? 16 : 16))),
    font: common(texty.map((e) => ("font" in e ? e.font ?? "sans" : "sans"))),
    align: common(texty.filter((e) => e.type !== "connector").map((e) => ("align" in e ? e.align ?? "center" : "center"))),
    route: common(connectors.map((e) => e.route)),
    startHead: common(connectors.map((e) => e.startHead)),
    endHead: common(connectors.map((e) => e.endHead)),
    textColor: common(shapes.map((e) => (e.type === "shape" ? e.color ?? "ink" : "ink"))),
    locked: els.every((e) => e.locked),
    grouped: els.some((e) => e.groupId),
    canFill: fillable.length > 0,
    canStroke: stroked.length > 0,
    hasText: texty.length > 0,
    hasConnector: connectors.length > 0,
    hasRadius: els.some((e) => e.type === "shape" && e.shape === "rect"),
    radius: els.length === 1 && els[0].type === "shape" && els[0].shape === "rect" ? els[0].radius ?? 12 : null,
  };
}

export interface PresenceChannel {
  send(p: LocalPresence): void;
}

type Listener = () => void;

export class Engine {
  readonly store = new DocStore();
  readonly geom = new GeometryCache(this.store);

  canvas: HTMLCanvasElement | null = null;
  host: HTMLElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  width = 0;
  height = 0;
  dpr = 1;
  camera: Camera = { x: 0, y: 0, zoom: 1 };

  /* interaction state, shared with pointer.ts */
  tool: ToolId = "select";
  toolLocked = false;
  shapeKind: ShapeKind = "rect";
  style: StyleDefaults = { ...DEFAULT_STYLE };
  view: ViewSettings = { ...DEFAULT_VIEW };
  selection = new Set<string>();
  hoverId: string | null = null;
  editing: EditingState | null = null;
  draft: El | null = null;
  marquee: Rect | null = null;
  guides: Guide[] = [];
  anchorTargets: { id: string; side?: Side }[] = [];
  fading = new Set<string>();
  connectorHandles: Point[] = [];
  anim = new Map<string, number>();
  spaceDown = false;
  cursor = "default";
  contextMenu: UiState["contextMenu"] = null;
  interacting = false;
  peers: Peer[] = [];
  clipboardMemo: El[] = [];
  /** Group currently "entered" for selecting its members individually. */
  enteredGroup: string | null = null;
  pasteCount = 0;

  presence: PresenceChannel | null = null;
  /** Uploads an image blob and returns a URL; falls back to an inline data URL when unset. */
  imageUploader: ((blob: Blob, name: string) => Promise<string>) | null = null;

  private _readOnly = false;
  private ui!: UiState;
  private uiListeners = new Set<Listener>();
  private cameraListeners = new Set<Listener>();
  private peerListeners = new Set<Listener>();
  private editListeners = new Set<Listener>();
  private raf = 0;
  private uiQueued = false;
  private camAnim: { from: Camera; to: Camera; start: number; dur: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubStore: (() => void) | null = null;
  private unsubSync: (() => void) | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceLast = 0;
  private presenceDirty = false;
  private peerKey = "";
  onToast: ((msg: string, kind?: "info" | "error") => void) | null = null;
  /** Set by the shell; opens the diagram-as-code editor (optionally for an existing diagram). */
  onOpenCode: ((opts?: { code?: string; replaceDiagramId?: string }) => void) | null = null;
  /** Set by the shell; opens the AI drawer. */
  onOpenAi: (() => void) | null = null;
  /** Set by the shell; opens the export dialog. */
  onOpenExport: (() => void) | null = null;
  /** Set by the shell; writes a picture of the selection (or the whole board) into the document pane. */
  onInsertSnapshot: (() => void) | null = null;
  /** Set by the shell; toggles the traffic simulation overlay. */
  onToggleSimulation: (() => void) | null = null;
  /** Set by the shell; toggles system design interview mode. */
  onToggleInterview: (() => void) | null = null;
  /** Which world point stays put when the canvas host changes size (see cameraAfterResize). */
  resizeAnchor: "start" | "center" = "start";
  /** Set by the comments layer: a click with the Comment tool, at a world position and over an element (if any). */
  onPlaceComment: ((at: Point, elementId: string | null) => void) | null = null;
  /** Whether the Comment tool may be used (set by the comments layer from the user's permissions). */
  commentsEnabled = false;

  constructor() {
    this.ui = this.buildUi();
    this.subscribeToStore();
  }

  private subscribeToStore() {
    if (this.unsubStore) return;
    this.unsubStore = this.store.subscribe(() => {
      this.pruneSelection();
      this.requestRender();
      if (!this.interacting) this.scheduleUi();
    });
    this.unsubSync = this.store.subscribeSync(() => this.scheduleUi());
  }

  /** Installs (or clears) the host callbacks the UI shell provides. */
  configure(opts: {
    onToast?: ((msg: string, kind?: "info" | "error") => void) | null;
    onOpenCode?: ((opts?: { code?: string; replaceDiagramId?: string }) => void) | null;
    onOpenAi?: (() => void) | null;
    onOpenExport?: (() => void) | null;
    onInsertSnapshot?: (() => void) | null;
    onToggleSimulation?: (() => void) | null;
    onToggleInterview?: (() => void) | null;
    resizeAnchor?: "start" | "center";
    onPlaceComment?: ((at: Point, elementId: string | null) => void) | null;
    commentsEnabled?: boolean;
    imageUploader?: ((blob: Blob, name: string) => Promise<string>) | null;
  }) {
    if (opts.onToast !== undefined) this.onToast = opts.onToast;
    if (opts.onOpenCode !== undefined) this.onOpenCode = opts.onOpenCode;
    if (opts.onOpenAi !== undefined) this.onOpenAi = opts.onOpenAi;
    if (opts.onOpenExport !== undefined) this.onOpenExport = opts.onOpenExport;
    if (opts.onInsertSnapshot !== undefined) this.onInsertSnapshot = opts.onInsertSnapshot;
    if (opts.onToggleSimulation !== undefined) this.onToggleSimulation = opts.onToggleSimulation;
    if (opts.onToggleInterview !== undefined) this.onToggleInterview = opts.onToggleInterview;
    if (opts.resizeAnchor !== undefined) this.resizeAnchor = opts.resizeAnchor;
    if (opts.onPlaceComment !== undefined) this.onPlaceComment = opts.onPlaceComment;
    if (opts.imageUploader !== undefined) this.imageUploader = opts.imageUploader;
    if (opts.commentsEnabled !== undefined && opts.commentsEnabled !== this.commentsEnabled) {
      this.commentsEnabled = opts.commentsEnabled;
      // losing the right to comment must not leave the tool armed
      if (!opts.commentsEnabled && this.tool === "comment") this.tool = "select";
      this.updateCursor();
      this.scheduleUi();
    }
  }

  closeContextMenu() {
    if (!this.contextMenu) return;
    this.contextMenu = null;
    this.scheduleUi();
  }

  /** Plays the short "pop in" animation for freshly created elements. */
  markNew(ids: Iterable<string>) {
    const now = performance.now();
    for (const id of ids) this.anim.set(id, now);
    this.requestRender();
  }

  /* ------------------------------------------------------------ lifecycle */

  attach(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.subscribeToStore(); // re-attaching after dispose() (React StrictMode / fast refresh) must work
    this.canvas = canvas;
    this.host = host;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(host);
    this.measure();
    void ensureFonts().then(() => this.requestRender());
    this.requestRender();
  }

  detach() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas = null;
    this.host = null;
    this.ctx = null;
  }

  /**
   * Releases timers, DOM hooks and store subscriptions and flushes unsaved edits. Deliberately
   * reversible: React StrictMode (and fast refresh) runs mount -> cleanup -> mount, so an engine
   * must come back to life when attach() is called again. UI listeners belong to React
   * subscriptions, which remove themselves.
   */
  dispose() {
    if (this.editing) this.commitEditing();
    this.store.closeGestures();
    this.detach();
    this.unsubStore?.();
    this.unsubStore = null;
    this.unsubSync?.();
    this.unsubSync = null;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
    void this.store.flush();
  }

  private measure() {
    if (!this.canvas || !this.host) return;
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    // Resizing the pane must not make the drawing jump: re-anchor the camera before adopting the new size.
    if (!this.pendingFit && !this.camAnim) this.camera = cameraAfterResize(this.camera, { w: this.width, h: this.height }, { w, h }, this.resizeAnchor);
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.pendingFit && this.hasRealSize()) {
      this.pendingFit = false;
      this.fitContent(false);
    }
    this.requestRender();
    this.emitCamera();
  }

  /* ----------------------------------------------------------- subscriptions */

  subscribeUi = (fn: Listener) => {
    this.uiListeners.add(fn);
    return () => {
      this.uiListeners.delete(fn);
    };
  };
  subscribeCamera = (fn: Listener) => {
    this.cameraListeners.add(fn);
    return () => {
      this.cameraListeners.delete(fn);
    };
  };
  subscribePeers = (fn: Listener) => {
    this.peerListeners.add(fn);
    return () => {
      this.peerListeners.delete(fn);
    };
  };
  subscribeEditing = (fn: Listener) => {
    this.editListeners.add(fn);
    return () => {
      this.editListeners.delete(fn);
    };
  };
  getUi = () => this.ui;

  private emitCamera() {
    for (const fn of this.cameraListeners) fn();
  }

  scheduleUi() {
    if (this.uiQueued) return;
    this.uiQueued = true;
    queueMicrotask(() => {
      this.uiQueued = false;
      this.ui = this.buildUi();
      for (const fn of this.uiListeners) fn();
    });
  }

  private buildUi(): UiState {
    const sel = this.selectedElements();
    const single = sel.length === 1 ? sel[0] : null;
    return {
      tool: this.tool,
      toolLocked: this.toolLocked,
      shapeKind: this.shapeKind,
      selection: Array.from(this.selection),
      selectionInfo: summarize(sel),
      zoomPct: Math.round(this.camera.zoom * 100),
      canUndo: this.store.canUndo(),
      canRedo: this.store.canRedo(),
      readOnly: this._readOnly,
      view: this.view,
      style: this.style,
      editing: this.editing,
      sync: this.store.syncState,
      syncError: this.store.syncError,
      peers: this.peers.map((p) => ({ sessionId: p.sessionId, userId: p.userId, name: p.name, avatar: p.avatar, color: p.color })),
      elementCount: this.store.size,
      spaceDown: this.spaceDown,
      cursor: this.cursor,
      contextMenu: this.contextMenu,
      commentsEnabled: this.commentsEnabled,
      quickAdd:
        single && !this._readOnly && !single.locked && this.tool === "select" && !this.editing && single.type !== "connector" && single.type !== "pen" && single.type !== "frame" && single.type !== "text"
          ? { id: single.id, box: single }
          : null,
    };
  }

  /* --------------------------------------------------------------- config */

  get readOnly() {
    return this._readOnly;
  }

  setReadOnly(v: boolean) {
    if (this._readOnly === v) return;
    this._readOnly = v;
    this.store.readOnly = v;
    if (v) {
      this.cancelEditing();
      if (this.tool !== "hand" && !(this.tool === "comment" && this.commentsEnabled)) this.tool = "select";
    }
    this.scheduleUi();
  }

  setCommit(fn: ((ops: Op[]) => Promise<void>) | null) {
    this.store.commit = fn;
  }

  setPresenceChannel(ch: PresenceChannel | null) {
    this.presence = ch;
    this.schedulePresence();
  }

  setView(patch: Partial<ViewSettings>) {
    this.view = { ...this.view, ...patch };
    this.geom.clear();
    this.requestRender();
    this.scheduleUi();
  }

  /* --------------------------------------------------------------- camera */

  get zoom() {
    return this.camera.zoom;
  }

  screenToWorld(p: Point): Point {
    return { x: (p.x - this.camera.x) / this.camera.zoom, y: (p.y - this.camera.y) / this.camera.zoom };
  }

  worldToScreen(p: Point): Point {
    return { x: p.x * this.camera.zoom + this.camera.x, y: p.y * this.camera.zoom + this.camera.y };
  }

  /** World-space rectangle currently visible. */
  viewport(): Rect {
    const z = this.camera.zoom;
    return { x: -this.camera.x / z, y: -this.camera.y / z, w: this.width / z, h: this.height / z };
  }

  setCamera(cam: Camera, animate = false, ms = 260) {
    const to = { x: cam.x, y: cam.y, zoom: clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM) };
    if (!animate) {
      this.camAnim = null;
      this.camera = to;
      this.afterCameraChange();
      return;
    }
    this.camAnim = { from: { ...this.camera }, to, start: performance.now(), dur: ms };
    this.requestRender();
  }

  private afterCameraChange() {
    this.requestRender();
    this.emitCamera();
    this.scheduleUi();
  }

  panBy(dx: number, dy: number) {
    this.camAnim = null;
    this.camera = { ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy };
    this.afterCameraChange();
  }

  /** Zoom by `factor` keeping the world point under `screen` fixed. */
  zoomAt(screen: Point, factor: number, animate = false) {
    const z0 = this.camera.zoom;
    const z1 = clamp(z0 * factor, MIN_ZOOM, MAX_ZOOM);
    const k = z1 / z0;
    const next = { zoom: z1, x: screen.x - (screen.x - this.camera.x) * k, y: screen.y - (screen.y - this.camera.y) * k };
    this.setCamera(next, animate, 160);
  }

  zoomBy(factor: number) {
    this.zoomAt({ x: this.width / 2, y: this.height / 2 }, factor, true);
  }

  zoomTo(zoom: number) {
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.zoomAt({ x: this.width / 2, y: this.height / 2 }, z / this.camera.zoom, true);
  }

  fitRect(rect: Rect, padding = 80, maxZoom = 1.6, animate = true) {
    if (!this.width || !this.height) return;
    const availW = Math.max(50, this.width - padding * 2);
    const availH = Math.max(50, this.height - padding * 2);
    const zoom = clamp(Math.min(availW / Math.max(1, rect.w), availH / Math.max(1, rect.h), maxZoom), MIN_ZOOM, MAX_ZOOM);
    this.setCamera(
      { zoom, x: (this.width - rect.w * zoom) / 2 - rect.x * zoom, y: (this.height - rect.h * zoom) / 2 - rect.y * zoom },
      animate,
      360
    );
  }

  contentBounds(): Rect | null {
    return unionRects(this.store.list().map((e) => this.geom.bounds(e)));
  }

  fitContent(animate = true) {
    const b = this.contentBounds();
    if (!b) {
      this.setCamera({ x: this.width / 2, y: this.height / 2, zoom: 1 }, animate);
      return;
    }
    this.fitRect(b, Math.min(110, Math.max(40, this.width * 0.08)), 1.25, animate);
  }

  /** Pans (and, if needed, zooms in a little) so the world point `p` is comfortably on screen. No-op if it already is. */
  revealPoint(p: Point, animate = true) {
    if (!this.width || !this.height) return;
    const s = this.worldToScreen(p);
    const margin = 90;
    if (s.x > margin && s.y > margin + 40 && s.x < this.width - margin && s.y < this.height - margin) return;
    const zoom = Math.max(this.camera.zoom, 0.6);
    this.setCamera({ zoom, x: this.width / 2 - p.x * zoom, y: this.height / 2 - p.y * zoom }, animate);
  }

  fitSelection() {
    const els = this.selectedElements();
    const b = selectionBounds(this.geom, els);
    if (b) this.fitRect(b, 120, 2, true);
  }

  resetView() {
    this.setCamera({ x: this.width / 2, y: this.height / 2, zoom: 1 }, true);
  }

  /* --------------------------------------------------------------- render */

  requestRender() {
    if (this.raf || !this.canvas) return;
    this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame() {
    this.raf = 0;
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    const now = performance.now();
    let more = false;

    if (this.camAnim) {
      const a = this.camAnim;
      const p = clamp((now - a.start) / a.dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const z = Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * e);
      // Interpolate the world point at the viewport centre so zoom animations feel anchored.
      const cx0 = (this.width / 2 - a.from.x) / a.from.zoom;
      const cy0 = (this.height / 2 - a.from.y) / a.from.zoom;
      const cx1 = (this.width / 2 - a.to.x) / a.to.zoom;
      const cy1 = (this.height / 2 - a.to.y) / a.to.zoom;
      const cx = cx0 + (cx1 - cx0) * e;
      const cy = cy0 + (cy1 - cy0) * e;
      this.camera = { zoom: z, x: this.width / 2 - cx * z, y: this.height / 2 - cy * z };
      if (p >= 1) {
        this.camera = { ...a.to };
        this.camAnim = null;
      } else more = true;
      this.emitCamera();
      this.scheduleUi();
    }

    for (const [id, started] of this.anim) if (now - started > 320) this.anim.delete(id);
    if (this.anim.size) more = true;

    const { box, handles, connectorPts } = this.computeSelectionVisuals();
    const state: RenderState = {
      camera: this.camera,
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      view: this.view,
      selection: this.selection,
      hoverId: this.hoverId,
      editingId: this.editing?.id ?? null,
      fading: this.fading,
      draft: this.draft,
      peers: this.peers,
      marquee: this.marquee,
      guides: this.guides,
      anchorTargets: this.anchorTargets,
      selectionBox: box ? { box, handles, rotatable: handles && this.rotatableSelection() } : null,
      connectorHandles: connectorPts,
      quickAdd: this.quickAddBox(),
      quickAddHover: this.quickAddHover,
      anim: this.anim,
      now,
      chrome: true,
      background: true,
      invalidate: () => this.requestRender(),
    };
    renderScene(ctx, this.store, this.geom, state);
    if (more) this.requestRender();
  }

  quickAddHover: Side | null = null;

  /** The single selected node that offers the "+" handles, if any. */
  quickAddBox(): Box | null {
    if (this._readOnly || this.tool !== "select" || this.editing || this.interacting || this.selection.size !== 1) return null;
    const el = this.store.get(Array.from(this.selection)[0]);
    if (!el || el.locked) return null;
    if (el.type === "connector" || el.type === "pen" || el.type === "frame" || el.type === "text") return null;
    return { x: el.x, y: el.y, w: el.w, h: el.h, angle: el.angle };
  }

  private rotatableSelection(): boolean {
    if (this.selection.size !== 1) return false;
    const el = this.store.get(Array.from(this.selection)[0]);
    return !!el && el.type !== "connector" && el.type !== "pen" && !el.locked && !this._readOnly;
  }

  private computeSelectionVisuals(): { box: Box | null; handles: boolean; connectorPts: Point[] } {
    if (this.selection.size === 0 || this.editing) return { box: null, handles: false, connectorPts: [] };
    const els = this.selectedElements();
    if (els.length === 0) return { box: null, handles: false, connectorPts: [] };
    if (els.length === 1) {
      const el = els[0];
      if (el.type === "connector") {
        const g = this.geom.connector(el);
        return { box: null, handles: false, connectorPts: this._readOnly || el.locked ? [] : [g.start, g.end] };
      }
      return {
        box: { x: el.x, y: el.y, w: el.w, h: el.h, angle: el.angle },
        handles: !this._readOnly && !el.locked,
        connectorPts: [],
      };
    }
    const b = selectionBounds(this.geom, els);
    if (!b) return { box: null, handles: false, connectorPts: [] };
    return { box: b, handles: !this._readOnly && !els.every((e) => e.locked), connectorPts: [] };
  }

  /* ------------------------------------------------------------ selection */

  selectedElements(): El[] {
    const out: El[] = [];
    for (const id of this.selection) {
      const el = this.store.get(id);
      if (el) out.push(el);
    }
    return out;
  }

  select(ids: Iterable<string>, opts: { expandGroup?: boolean } = {}) {
    let set = new Set(ids);
    if (opts.expandGroup !== false) set = expandGroups(this.store, set);
    this.selection = set;
    this.contextMenu = null;
    this.requestRender();
    this.scheduleUi();
    this.schedulePresence();
  }

  clearSelection() {
    if (this.selection.size === 0) return;
    this.selection = new Set();
    this.enteredGroup = null;
    this.requestRender();
    this.scheduleUi();
    this.schedulePresence();
  }

  selectAll() {
    this.select(this.store.list().map((e) => e.id), { expandGroup: false });
  }

  private pruneSelection() {
    if (this.selection.size === 0) return;
    let changed = false;
    for (const id of this.selection) {
      if (!this.store.get(id)) {
        this.selection.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.selection = new Set(this.selection);
      this.scheduleUi();
    }
  }

  setHover(id: string | null) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.requestRender();
  }

  /* --------------------------------------------------------------- history */

  undo() {
    if (this.editing) this.commitEditing();
    const ids = this.store.undo();
    if (ids) this.select(ids.filter((id) => this.store.get(id)), { expandGroup: false });
  }

  redo() {
    if (this.editing) this.commitEditing();
    const ids = this.store.redo();
    if (ids) this.select(ids.filter((id) => this.store.get(id)), { expandGroup: false });
  }

  /**
   * Replaces the board with a saved version as ONE undoable step (and one batched write). Returns what
   * changed; collaborators receive it like any other edit.
   */
  restoreElements(els: El[]): { put: number; removed: number } {
    if (this.editing) this.commitEditing();
    const res = this.store.restoreTo(els);
    this.geom.clear();
    this.selection = new Set();
    this.enteredGroup = null;
    this.requestRender();
    this.scheduleUi();
    return res;
  }

  /* ------------------------------------------------------------------ tool */

  setTool(tool: ToolId, opts: { shape?: ShapeKind; lock?: boolean } = {}) {
    if (tool === "comment" ? !this.commentsEnabled : this._readOnly && tool !== "hand" && tool !== "select") return;
    if (this.editing) this.commitEditing();
    this.tool = tool;
    if (opts.shape) this.shapeKind = opts.shape;
    if (opts.lock !== undefined) this.toolLocked = opts.lock;
    if (tool !== "select") {
      this.hoverId = null;
      if (tool !== "hand") this.clearSelection();
    }
    this.draft = null;
    this.anchorTargets = [];
    this.guides = [];
    this.updateCursor();
    this.requestRender();
    this.scheduleUi();
    this.schedulePresence();
  }

  finishTool() {
    if (!this.toolLocked && this.tool !== "select") this.setTool("select");
  }

  updateCursor(override?: string) {
    let c = override;
    if (!c) {
      if (this.spaceDown || this.tool === "hand") c = "grab";
      else if (this.tool === "select") c = "default";
      else if (this.tool === "eraser") c = "crosshair";
      else if (this.tool === "text") c = "text";
      else if (this.tool === "comment") c = COMMENT_CURSOR;
      else c = "crosshair";
    }
    if (c !== this.cursor) {
      this.cursor = c;
      if (this.host) this.host.style.cursor = c;
    }
  }

  /* ---------------------------------------------------------------- editing */

  startEditing(id: string, field: EditField, isNew = false) {
    if (this._readOnly) return;
    const el = this.store.get(id);
    if (!el) return;
    if (this.editing) this.commitEditing();
    let value = "";
    switch (field) {
      case "text":
        value = "text" in el ? el.text ?? "" : "";
        break;
      case "title":
        value = "title" in el ? el.title : "";
        break;
      case "label":
        value = el.type === "connector" ? el.label ?? "" : "";
        break;
      case "card":
        value = el.type === "card" ? (el.subtitle ? `${el.title}\n${el.subtitle}` : el.title) : "";
        break;
      case "iconLabel":
        value = el.type === "icon" ? el.label ?? "" : "";
        break;
    }
    this.store.begin();
    this.editing = { id, field, value, isNew };
    this.select([id], { expandGroup: false });
    this.requestRender();
    this.scheduleUi();
    for (const fn of this.editListeners) fn();
  }

  updateEditing(value: string) {
    if (!this.editing) return;
    this.editing = { ...this.editing, value };
    const el = this.store.get(this.editing.id);
    if (el?.type === "text") {
      const size = textSize(value, el, el.autoW ? undefined : el.w);
      this.store.patch(el.id, { w: el.autoW ? Math.max(size.w, 12) : el.w, h: Math.max(size.h, el.fontSize * 1.3) } as Partial<El>);
    }
    for (const fn of this.editListeners) fn();
    this.requestRender();
  }

  commitEditing() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const el = this.store.get(ed.id);
    const value = ed.value;
    if (el) {
      const trimmed = value.replace(/\s+$/g, "");
      switch (ed.field) {
        case "text":
          if (el.type === "text" || el.type === "shape" || el.type === "sticky") {
            if (el.type === "text" && trimmed.trim() === "") this.store.remove(el.id);
            else this.store.patch(el.id, { text: el.type === "text" ? trimmed : value } as Partial<El>);
          }
          break;
        case "title":
          if (el.type === "frame" || el.type === "table") this.store.patch(el.id, { title: value.trim() || el.title } as Partial<El>);
          break;
        case "label":
          if (el.type === "connector") this.store.patch(el.id, { label: value.trim() || undefined } as Partial<El>);
          break;
        case "iconLabel":
          if (el.type === "icon") this.store.patch(el.id, { label: value.trim() || undefined } as Partial<El>);
          break;
        case "card":
          if (el.type === "card") {
            const [first, ...rest] = value.split("\n");
            const sub = rest.join("\n").trim();
            this.store.patch(el.id, { title: first.trim() || el.title, subtitle: sub || undefined } as Partial<El>);
          }
          break;
      }
    }
    this.store.end();
    this.requestRender();
    this.scheduleUi();
    for (const fn of this.editListeners) fn();
  }

  cancelEditing() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const el = this.store.get(ed.id);
    // A brand new empty text box leaves no trace.
    if (el && ed.isNew && el.type === "text" && !("text" in el && el.text)) this.store.remove(el.id);
    this.store.end();
    this.requestRender();
    this.scheduleUi();
    for (const fn of this.editListeners) fn();
  }

  /* --------------------------------------------------------------- presence */

  setPeers(peers: Peer[]) {
    this.peers = peers;
    const key = peers.map((p) => `${p.sessionId}:${p.name}:${p.color}`).join("|");
    if (key !== this.peerKey) {
      this.peerKey = key;
      this.scheduleUi();
    }
    for (const fn of this.peerListeners) fn();
    this.requestRender();
  }

  cursorWorld: Point | null = null;

  schedulePresence() {
    if (!this.presence) return;
    this.presenceDirty = true;
    if (this.presenceTimer) return;
    // Back off as the room grows: every update fans out to every other client.
    const interval = Math.min(400, 66 + this.peers.length * 25);
    const wait = Math.max(0, interval - (Date.now() - this.presenceLast));
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (!this.presenceDirty || !this.presence) return;
      this.presenceDirty = false;
      this.presenceLast = Date.now();
      this.presence.send(this.buildPresence());
    }, wait);
  }

  /** Live drag preview data, set by pointer.ts while moving. */
  dragPreview: LocalPresence["drag"] = null;

  private buildPresence(): LocalPresence {
    return {
      cursor: this.cursorWorld,
      selection: Array.from(this.selection).slice(0, 60),
      draft: this.draft && this.draft.type !== "pen" ? this.draft : this.draft && this.draft.type === "pen" ? thinPen(this.draft) : null,
      drag: this.dragPreview,
      tool: this.tool,
    };
  }

  /* ------------------------------------------------------------------ misc */

  toast(msg: string, kind: "info" | "error" = "info") {
    this.onToast?.(msg, kind);
  }

  elementsAt(rect: Rect) {
    return elementsInRect(this.store, this.geom, rect);
  }

  themeColors() {
    return THEMES[this.view.theme];
  }

  /** Loads a document and frames it. */
  loadElements(list: El[], fit = true) {
    this.store.load(list);
    this.geom.clear();
    this.selection = new Set();
    if (fit) {
      if (this.hasRealSize()) this.fitContent(false);
      else this.pendingFit = true;
    }
    this.scheduleUi();
  }

  /** Frames the content (or centres an empty board) once the viewport has been measured. */
  initialFit() {
    if (this.hasRealSize()) this.fitContent(false);
    else this.pendingFit = true;
  }

  /** True once the host has been laid out (avoids fitting to a 0-1px viewport on first paint). */
  private hasRealSize() {
    return this.width > 160 && this.height > 160;
  }

  private pendingFit = false;
}

function thinPen(el: El): El {
  if (el.type !== "pen") return el;
  if (el.pts.length <= 240) return el;
  const out: number[] = [];
  const step = Math.ceil(el.pts.length / 2 / 120);
  for (let i = 0; i + 1 < el.pts.length; i += 2 * step) out.push(el.pts[i], el.pts[i + 1]);
  out.push(el.pts[el.pts.length - 2], el.pts[el.pts.length - 1]);
  return { ...el, pts: out };
}
