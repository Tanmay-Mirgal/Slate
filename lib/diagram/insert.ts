import { insertElements } from "../canvas/commands";
import { unionRects } from "../canvas/geometry";
import { newId } from "../canvas/ids";
import { boxBounds } from "../canvas/geometry";
import type { Engine } from "../canvas/engine";
import type { ConnectorEl, El, Point, Rect } from "../canvas/types";
import type { Graph } from "./graph";
import { describeLayout, layoutGraph, type LayoutResult } from "./layout";

export interface PlacedDiagram {
  diagramId: string;
  ids: string[];
  bounds: Rect;
  summary: string;
}

const rectOfEl = (e: El): Rect => {
  if (e.type === "connector") {
    const pts = (e as ConnectorEl).points;
    return unionRects(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))) ?? { x: e.x, y: e.y, w: e.w, h: e.h };
  }
  return boxBounds(e);
};

/** Bounding box of laid-out elements, connectors included (what insertElements positions by). */
export function elementsBounds(els: El[]): Rect | null {
  return unionRects(els.map(rectOfEl));
}

export interface PlaceOptions {
  replaceDiagramId?: string;
  /** Top-left to put the diagram at instead of searching for free space. Ignored when replacing. */
  at?: Point;
  /** A layout of exactly this graph computed earlier (for example by a live preview), so it isn't redone. */
  layout?: LayoutResult;
  /** Fade the elements in (default). Turn off when an identical preview was just on screen. */
  animate?: boolean;
}

/**
 * Lays a graph out and puts it on the board as ONE undoable step. With `replaceDiagramId` the
 * previous version of that diagram is swapped out in place (same top-left corner), which is how
 * "edit this diagram with AI" and re-applying edited code work.
 */
export async function placeGraph(engine: Engine, graph: Graph, opts: PlaceOptions = {}): Promise<PlacedDiagram> {
  const diagramId = opts.layout?.diagramId ?? opts.replaceDiagramId ?? newId("dg");
  // With a ready layout nothing below awaits, so the board changes within the caller's own tick.
  const result = opts.layout ?? (await layoutGraph(graph, { diagramId }));

  engine.store.begin();
  try {
    let at: "free" | Point = opts.at ?? "free";
    if (opts.replaceDiagramId) {
      const old = engine.store.list().filter((e) => e.diagramId === opts.replaceDiagramId);
      if (old.length) {
        const b = unionRects(old.map(rectOfEl));
        if (b) at = { x: b.x, y: b.y };
        engine.store.removeMany(old.map((e) => e.id));
      }
    }
    // Not selected on purpose: a fully highlighted diagram is noisy and hides what was generated.
    const placed = insertElements(engine, result.elements, { at, select: false, fit: true, animate: opts.animate });
    return {
      diagramId,
      ids: placed?.ids ?? [],
      bounds: placed?.bounds ?? result.bounds,
      summary: describeLayout(result),
    };
  } finally {
    engine.store.end();
  }
}
