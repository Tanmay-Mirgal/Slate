import { findIconDef } from "../canvas/icons-catalog";
import type { ConnectorEl, El, Rect } from "../canvas/types";
import type { DiagramKind, EdgeArrow, GEdge, GGroup, GNode, Graph } from "./graph";
import { slug } from "./graph";

const rectOf = (e: El): Rect => ({ x: e.x, y: e.y, w: e.w, h: e.h });
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;
const area = (r: Rect) => r.w * r.h;

const FLOW_OF: Record<string, GNode["shape"]> = {
  diamond: "decision",
  stadium: "terminator",
  parallelogram: "io",
  cylinder: "data",
  document: "document",
  cloud: "cloud",
  hexagon: "hexagon",
};

/**
 * Rebuilds a semantic graph from canvas elements (cards, labelled shapes, icons, tables, frames,
 * connectors). Used for "copy as code" and to give the AI the current diagram when revising it.
 */
export function graphFromElements(els: El[]): Graph {
  const nodes: GNode[] = [];
  const idOf = new Map<string, string>();
  const used = new Set<string>();
  const uniqueId = (label: string) => {
    let id = slug(label);
    while (used.has(id)) id += "_";
    used.add(id);
    return id;
  };

  const frames = els.filter((e) => e.type === "frame");
  const groups: GGroup[] = frames.map((f) => ({
    id: uniqueId(f.type === "frame" ? f.title || "group" : "group"),
    label: f.type === "frame" ? f.title || "Group" : "Group",
    color: f.type === "frame" ? f.accent : undefined,
  }));
  const frameGroup = new Map(frames.map((f, i) => [f.id, groups[i]]));
  const smallestFrameContaining = (r: Rect, selfId?: string) => {
    let best: El | null = null;
    for (const f of frames) {
      if (f.id === selfId) continue;
      if (contains(rectOf(f), r) && (!best || area(rectOf(f)) < area(rectOf(best)))) best = f;
    }
    return best;
  };
  frames.forEach((f, i) => {
    const parent = smallestFrameContaining(rectOf(f), f.id);
    if (parent) groups[i].parent = frameGroup.get(parent.id)!.id;
  });

  let tables = 0;
  let flowShapes = 0;
  for (const e of els) {
    let node: GNode | null = null;
    if (e.type === "card") {
      node = { id: "", label: e.title, subtitle: e.subtitle, icon: e.icon };
    } else if (e.type === "shape" && e.text?.trim()) {
      const shape = FLOW_OF[e.shape];
      if (shape || e.shape === "rect" || e.shape === "ellipse") flowShapes++;
      node = { id: "", label: e.text.trim().replace(/\s+/g, " "), shape: shape ?? "process", icon: e.icon };
    } else if (e.type === "icon" && e.label) {
      node = { id: "", label: e.label, icon: e.icon };
    } else if (e.type === "table") {
      tables++;
      node = { id: "", label: e.title, fields: e.columns };
    }
    if (!node) continue;
    node.id = uniqueId(node.label);
    const frame = smallestFrameContaining(rectOf(e));
    if (frame) node.group = frameGroup.get(frame.id)!.id;
    if (node.icon && !findIconDef(node.icon) && !node.icon.startsWith("lucide:")) node.icon = undefined;
    nodes.push(node);
    idOf.set(e.id, node.id);
  }

  const edges: GEdge[] = [];
  for (const e of els) {
    if (e.type !== "connector") continue;
    const c = e as ConnectorEl;
    const from = c.start ? idOf.get(c.start.id) : undefined;
    const to = c.end ? idOf.get(c.end.id) : undefined;
    if (!from || !to || from === to) continue;
    const arrow: EdgeArrow = c.startHead !== "none" && c.endHead !== "none" ? "both" : c.startHead !== "none" ? "back" : c.endHead !== "none" ? "forward" : "none";
    edges.push({ from, to, label: c.label, arrow, style: c.dash === "dashed" || c.dash === "dotted" ? c.dash : undefined });
  }

  const kind: DiagramKind = tables > 0 ? "erd" : flowShapes > nodes.length / 2 ? "flowchart" : "architecture";
  const usedGroups = groups.filter((g) => nodes.some((n) => n.group === g.id) || groups.some((c) => c.parent === g.id));
  return { kind, direction: "auto", nodes, groups: usedGroups, edges };
}

/** diagramId shared by the selection (all elements from one generated diagram), if any. */
export function commonDiagramId(els: El[]): string | undefined {
  const ids = new Set(els.map((e) => e.diagramId).filter(Boolean) as string[]);
  return ids.size === 1 ? Array.from(ids)[0] : undefined;
}
