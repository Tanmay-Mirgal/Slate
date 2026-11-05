import { boardStats } from "@/lib/canvas/stats";
import type { El, Rect } from "@/lib/canvas/types";
import { unionRects } from "@/lib/canvas/geometry";
import { getCollections } from "@/lib/db/mongo";
import type { SlateDoc } from "@/lib/db/types";
import { graphToDsl } from "@/lib/diagram/dsl";
import type { Graph } from "@/lib/diagram/graph";
import { layoutGraph, shiftElement } from "@/lib/diagram/layout";
import * as elementsFns from "@/lib/server/elements";
import { invoke } from "@/lib/server/fn";
import * as slateFns from "@/lib/server/slates";
import { autoSnapshot } from "@/lib/server/versions";
import type { AuthedGrant } from "../auth/verify";
import { loadBoardElements } from "../data";

/** Same cap `elements.apply` enforces per call. */
const BATCH = 500;
/** Space between what was already on the board and an appended diagram. */
const APPEND_GAP = 160;

export interface WrittenDiagram {
  diagramId: string;
  kind: string;
  nodes: number;
  edges: number;
  groups: number;
  /** The diagram as diagram-as-code, normalised. */
  dsl: string;
  stats: { nodes: number; connectors: number };
}

const rectOf = (el: El): Rect => {
  if (el.type === "connector") return unionRects(el.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))) ?? { x: el.x, y: el.y, w: el.w, h: el.h };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
};

/**
 * Lays `graph` out on the server and writes it to the board through the same `elements.apply` the editor uses,
 * so everybody looking at the board sees it appear live and every size / access rule of the app applies.
 *
 *   replace  the board's current content is removed (after a safety version, so it can be restored from version history)
 *   append   the diagram is placed to the right of whatever is there
 *
 * All the elements share one `diagramId`, which is what lets "Edit this diagram" in the editor find them again.
 */
export async function writeDiagram(grant: AuthedGrant, slate: Pick<SlateDoc, "_id">, graph: Graph, opts: { mode: "replace" | "append"; diagramId?: string }): Promise<WrittenDiagram> {
  const c = await getCollections();
  const layout = await layoutGraph(graph, opts.diagramId ? { diagramId: opts.diagramId } : {});

  let placed = layout.elements;
  let existing: El[] = [];
  let removeIds: string[] = [];
  if (opts.mode === "replace") {
    const rows = await c.elements.find({ slateId: slate._id, deleted: { $ne: true } }).project<{ eid: string }>({ eid: 1 }).toArray();
    removeIds = rows.map((r) => r.eid);
    // an earlier version of the board stays one click away; failing to take it never blocks the write
    if (removeIds.length > 0) await autoSnapshot(slate._id).catch(() => undefined);
  } else {
    existing = await loadBoardElements(slate._id);
    const bounds = unionRects(existing.map(rectOf));
    if (bounds) placed = placed.map((el) => shiftElement(el, bounds.x + bounds.w + APPEND_GAP - layout.bounds.x, bounds.y - layout.bounds.y));
  }

  const keep = new Set(placed.map((e) => e.id));
  const ops = [
    ...removeIds.filter((id) => !keep.has(id)).map((id) => ({ t: "del" as const, id })),
    ...placed.map((el) => ({ t: "put" as const, id: el.id, z: el.z, data: JSON.stringify(el) })),
  ];
  for (let i = 0; i < ops.length; i += BATCH) {
    await invoke(elementsFns.apply, grant.ctx, { slateId: slate._id, ops: ops.slice(i, i + BATCH) });
  }

  const stats = boardStats([...existing, ...placed]);
  await invoke(slateFns.reportStats, grant.ctx, { id: slate._id, nodes: stats.nodes, connectors: stats.connectors });
  await c.slates.updateOne({ _id: slate._id }, { $set: { lastEdited: Date.now() } });

  return {
    diagramId: layout.diagramId,
    kind: graph.kind,
    nodes: graph.nodes.length,
    edges: graph.kind === "sequence" ? (graph.messages?.length ?? 0) : graph.edges.length,
    groups: graph.groups.length,
    dsl: graphToDsl(graph),
    stats,
  };
}
