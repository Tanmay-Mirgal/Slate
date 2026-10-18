import { insertElements } from "../canvas/commands";
import { unionRects } from "../canvas/geometry";
import { newId } from "../canvas/ids";
import { boxBounds } from "../canvas/geometry";
import type { Engine } from "../canvas/engine";
import type { ConnectorEl, El, Rect } from "../canvas/types";
import type { Graph } from "./graph";
import { describeLayout, layoutGraph } from "./layout";

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

/**
 * Lays a graph out and puts it on the board as ONE undoable step. With `replaceDiagramId` the
 * previous version of that diagram is swapped out in place (same top-left corner), which is how
 * "edit this diagram with AI" and re-applying edited code work.
 */
export async function placeGraph(engine: Engine, graph: Graph, opts: { replaceDiagramId?: string } = {}): Promise<PlacedDiagram> {
  const diagramId = opts.replaceDiagramId ?? newId("dg");
  const result = await layoutGraph(graph, { diagramId });

  engine.store.begin();
  try {
    let at: "free" | { x: number; y: number } = "free";
    if (opts.replaceDiagramId) {
      const old = engine.store.list().filter((e) => e.diagramId === opts.replaceDiagramId);
      if (old.length) {
        const b = unionRects(old.map(rectOfEl));
        if (b) at = { x: b.x, y: b.y };
        engine.store.removeMany(old.map((e) => e.id));
      }
    }
    // Not selected on purpose: a fully highlighted diagram is noisy and hides what was generated.
    const placed = insertElements(engine, result.elements, { at, select: false, fit: true });
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
