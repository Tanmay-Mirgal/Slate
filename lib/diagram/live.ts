import type { StreamItem } from "../ai/stream-parse";
import type { Engine } from "../canvas/engine";
import { clamp, lerp } from "../canvas/geometry";
import { newId } from "../canvas/ids";
import type { LiveScene } from "../canvas/render";
import { GeometryCache } from "../canvas/scene";
import { DocStore } from "../canvas/store";
import type { El, Point } from "../canvas/types";
import type { DiagramKind, GEdge, Graph } from "./graph";
import { elementsBounds, placeGraph, type PlacedDiagram } from "./insert";
import { layoutGraph, shiftElement, warmLayout, type LayoutResult } from "./layout";
import { StreamingGraph } from "./stream";

/** Shortest pause between two layouts; the real gap also scales with how long the last layout took, up to MAX_GAP_MS. */
const MIN_GAP_MS = 420;
const MAX_GAP_MS = 1500;
const TWEEN_MS = 320;
/** Don't re-aim the camera more often than this while the diagram outgrows the screen. */
const FOLLOW_GAP_MS = 900;
/** Real (edge-driven) layout takes over once this share of the components has a connection. */
const LINKED_ENOUGH = 0.7;
/** Above this many connectors, positions snap instead of tweening (every frame would re-route them all). */
const TWEEN_MAX_CONNECTORS = 120;

export interface LiveStats {
  nodes: number;
  edges: number;
}

export interface LiveOptions {
  /** The diagram this one will replace on commit; it is dimmed while the new one is drawn. */
  replaceDiagramId?: string;
  fallbackKind?: DiagramKind;
  onStats?: (s: LiveStats) => void;
}

function linkedShare(g: Graph): number {
  if (!g.nodes.length) return 0;
  const linked = new Set<string>();
  for (const e of g.edges) {
    linked.add(e.from);
    linked.add(e.to);
  }
  return linked.size / g.nodes.length;
}

/**
 * Before the connections have streamed in there is nothing to lay out by, and ELK would line every
 * component up in one long row. Give it scaffolding instead: a grid (each component hangs under the
 * one `cols` places before it) or, for a mind map, a star around the root. The scaffolding is never
 * drawn; it only decides where the cards drop in until the real connections take over.
 */
function scaffold(g: Graph): Graph {
  const n = g.nodes.length;
  let edges: GEdge[];
  if (g.kind === "mindmap") edges = g.nodes.slice(1).map((c) => ({ from: g.nodes[0].id, to: c.id }));
  else {
    const cols = clamp(Math.round(Math.sqrt(n * 1.8)), 3, 6);
    edges = g.nodes.slice(cols).map((c, i) => ({ from: g.nodes[i].id, to: c.id }));
  }
  return { ...g, direction: "down", edges };
}

/**
 * Draws an AI diagram on the canvas while the model is still writing it.
 *
 * Streamed components and connections go into a private scene that the engine paints above the
 * board. Nothing touches the document until `commit`, so there is no sync traffic, no undo noise and
 * collaborators never see half a diagram. Each time new pieces arrive the diagram is laid out again
 * (throttled) and the components glide to their new places.
 */
export class LiveDiagram {
  readonly diagramId: string;
  private readonly scene: LiveScene;
  private readonly origin: Point;
  private readonly startedEmpty: boolean;
  private readonly hidden: string[] = [];

  private graph: StreamingGraph;
  private current = new Map<string, El>();
  private from = new Map<string, El>();
  private target: El[] = [];
  private tweenStart = 0;
  /** Too many connectors to re-route every frame: jump straight to the new layout. */
  private snap = false;
  private tweenRaf = 0;
  private tweenWaiters: (() => void)[] = [];

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private dirty = false;
  private nextAt = 0;
  private epoch = 0;
  private lastFit = 0;
  private disposed = false;

  constructor(
    private readonly engine: Engine,
    private readonly opts: LiveOptions = {}
  ) {
    this.diagramId = opts.replaceDiagramId ?? newId("dg");
    this.graph = new StreamingGraph(opts.fallbackKind);
    const store = new DocStore();
    this.scene = { store, geom: new GeometryCache(store), anim: new Map() };
    this.startedEmpty = engine.store.size === 0;
    this.origin = this.pickOrigin();

    if (opts.replaceDiagramId) {
      for (const el of engine.store.list()) {
        if (el.diagramId !== opts.replaceDiagramId) continue;
        this.hidden.push(el.id);
        engine.fading.add(el.id);
      }
    }
    engine.live = this.scene;
    warmLayout();
  }

  /** Top-left of the diagram: where the old version was, else just right of everything, else the viewport corner. */
  private pickOrigin(): Point {
    const e = this.engine;
    if (this.opts.replaceDiagramId) {
      const b = elementsBounds(e.store.list().filter((x) => x.diagramId === this.opts.replaceDiagramId));
      if (b) return { x: b.x, y: b.y };
    }
    const content = e.contentBounds();
    if (content) return { x: content.x + content.w + 140, y: content.y };
    const vp = e.viewport();
    return { x: vp.x + vp.w * 0.08, y: vp.y + vp.h * 0.1 };
  }

  /* ------------------------------------------------------------------ input */

  push(item: StreamItem) {
    if (this.disposed || !this.graph.push(item)) return;
    this.schedule();
  }

  /** The model started over (retry / another model): wipe the half-drawn diagram. */
  reset() {
    if (this.disposed) return;
    this.epoch++;
    this.graph = new StreamingGraph(this.opts.fallbackKind);
    this.clearTimer();
    this.stopTween();
    this.current.clear();
    this.from.clear();
    this.target = [];
    this.scene.store.load([]);
    this.scene.anim.clear();
    this.engine.requestRender();
  }

  /* ----------------------------------------------------------------- layout */

  private schedule() {
    if (this.disposed) return;
    if (this.busy) {
      this.dirty = true;
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.run();
    }, Math.max(0, this.nextAt - Date.now()));
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async layout(g: Graph): Promise<LayoutResult> {
    if (g.kind === "sequence" || linkedShare(g) >= LINKED_ENOUGH) return layoutGraph(g, { diagramId: this.diagramId });
    const r = await layoutGraph(scaffold(g), { diagramId: this.diagramId });
    return { ...r, elements: r.elements.filter((el) => el.type !== "connector") };
  }

  private async run() {
    if (this.disposed) return;
    this.busy = true;
    this.dirty = false;
    const epoch = this.epoch;
    const t0 = performance.now();
    try {
      const g = this.graph.snapshot();
      if (!g) return;
      const layout = await this.layout(g);
      if (epoch !== this.epoch || this.disposed) return;
      this.opts.onStats?.({ nodes: g.nodes.length, edges: g.edges.length });
      this.apply(layout.elements);
    } catch {
      /* a half-written graph can fail to lay out; the next piece usually fixes it */
    } finally {
      this.busy = false;
      this.nextAt = Date.now() + clamp((performance.now() - t0) * 2, MIN_GAP_MS, MAX_GAP_MS);
      if (this.dirty) this.schedule();
    }
  }

  /** Moves the laid-out elements to the diagram's origin and glides the scene towards them. */
  private apply(elements: El[]) {
    const b = elementsBounds(elements);
    const dx = this.origin.x - (b?.x ?? 0);
    const dy = this.origin.y - (b?.y ?? 0);
    const shifted = elements.map((el) => shiftElement(el, dx, dy));
    const now = performance.now();
    for (const el of shifted) if (!this.current.has(el.id)) this.scene.anim.set(el.id, now);
    this.from = new Map(this.current);
    this.target = shifted;
    this.snap = shifted.filter((el) => el.type === "connector").length > TWEEN_MAX_CONNECTORS;
    this.tweenStart = now;
    this.startTween();
    this.follow(shifted);
  }

  /* ------------------------------------------------------------------ tween */

  private frameAt(eased: number): El[] {
    if (eased >= 1) return this.target;
    return this.target.map((el): El => {
      // Mid-flight a cached route would point at where the nodes used to be: drop it so the router re-routes live.
      if (el.type === "connector") return { ...el, routeSig: undefined };
      const prev = this.from.get(el.id);
      if (!prev || prev.type === "connector") return el;
      return { ...el, x: lerp(prev.x, el.x, eased), y: lerp(prev.y, el.y, eased), w: lerp(prev.w, el.w, eased), h: lerp(prev.h, el.h, eased) } as El;
    });
  }

  private startTween() {
    if (this.tweenRaf) return; // the running loop picks up the new target
    const tick = () => {
      this.tweenRaf = 0;
      if (this.disposed) return;
      const t = this.snap ? 1 : clamp((performance.now() - this.tweenStart) / TWEEN_MS, 0, 1);
      const els = this.frameAt(1 - Math.pow(1 - t, 3));
      this.current = new Map(els.map((el) => [el.id, el]));
      this.scene.store.load(els);
      this.engine.requestRender();
      if (t < 1) this.tweenRaf = requestAnimationFrame(tick);
      else this.releaseWaiters();
    };
    this.tweenRaf = requestAnimationFrame(tick);
  }

  private stopTween() {
    if (this.tweenRaf) cancelAnimationFrame(this.tweenRaf);
    this.tweenRaf = 0;
    this.releaseWaiters();
  }

  private releaseWaiters() {
    for (const done of this.tweenWaiters.splice(0)) done();
  }

  private settled(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.tweenRaf) resolve();
      else this.tweenWaiters.push(resolve);
    });
  }

  /** Keeps the growing diagram in view without fighting the user over the camera. */
  private follow(els: El[]) {
    const b = elementsBounds(els);
    if (!b) return;
    const vp = this.engine.viewport();
    const inside = b.x >= vp.x && b.y >= vp.y && b.x + b.w <= vp.x + vp.w && b.y + b.h <= vp.y + vp.h;
    const now = performance.now();
    if (inside || now - this.lastFit < FOLLOW_GAP_MS) return;
    this.lastFit = now;
    this.engine.fitRect(b, 100, 1.2, true);
  }

  /* ----------------------------------------------------------------- finish */

  /**
   * Lands the finished diagram: settles the preview on the exact final layout, then swaps it for the
   * real elements in one undoable step. Because both are the same layout at the same spot, the swap
   * is invisible.
   */
  async commit(graph: Graph): Promise<PlacedDiagram> {
    this.clearTimer();
    await this.running;
    if (this.disposed) throw new Error("The live preview was closed");
    const epoch = ++this.epoch; // anything still in flight is stale now
    const layout = await layoutGraph(graph, { diagramId: this.diagramId });
    if (this.disposed || epoch !== this.epoch) throw new Error("The live preview was closed");
    this.opts.onStats?.({ nodes: graph.nodes.length, edges: graph.edges.length });
    this.apply(layout.elements);
    // A hidden tab pauses animation frames; don't let that stall the hand-over.
    await Promise.race([this.settled(), new Promise<void>((resolve) => setTimeout(resolve, TWEEN_MS + 200))]);

    // placeGraph has nothing to await when it is handed a layout, so it changes the board synchronously;
    // disposing right after means the preview and the real elements are never on screen together.
    const placing = placeGraph(this.engine, graph, { replaceDiagramId: this.opts.replaceDiagramId, at: this.origin, layout, animate: false });
    this.dispose();
    const placed = await placing;
    if (this.startedEmpty && placed.ids.length) this.engine.fitRect(placed.bounds, 100, 1.2, true);
    return placed;
  }

  /** Removes the preview (cancel, error, or after commit). Safe to call repeatedly. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.clearTimer();
    this.stopTween();
    for (const id of this.hidden) this.engine.fading.delete(id);
    if (this.engine.live === this.scene) this.engine.live = null;
    this.engine.requestRender();
  }
}
