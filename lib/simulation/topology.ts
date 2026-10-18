import { declaredCopies, familyKey, isInherentlyRedundant, kindOf, nodeTextOf, type NodeKind, type NodeText } from "../cloud/classify";
import type { ConnectorEl, El } from "../canvas/types";

/**
 * Turns the connectors on a board into a dependency graph and finds the places where one failure
 * takes a lot down with it. Only connectors bound to elements at both ends take part, so loose
 * arrows and annotations never create phantom dependencies.
 */

export interface TopoNode {
  id: string;
  label: string;
  kind: NodeKind;
  text: NodeText;
  /** Direct callers: nodes with a connector pointing at this one. */
  callers: Set<string>;
  /** Direct dependencies: nodes this one points at. */
  callees: Set<string>;
  /** Copies of this component, from its label and from identical sibling boxes. */
  copies: number;
  redundantByNature: boolean;
}

export interface Topology {
  nodes: Map<string, TopoNode>;
  edges: { id: string; from: string; to: string }[];
}

/** Which way requests flow along a connector: start -> end unless only the start has an arrowhead. */
export function flowDirections(c: ConnectorEl): ("forward" | "backward")[] {
  const start = c.startHead !== "none";
  const end = c.endHead !== "none";
  if (start && end) return ["forward", "backward"];
  if (start && !end) return ["backward"];
  return ["forward"];
}

export function buildTopology(els: El[]): Topology {
  const byId = new Map<string, El>();
  for (const el of els) byId.set(el.id, el);

  const nodes = new Map<string, TopoNode>();
  const ensure = (id: string): TopoNode | null => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const el = byId.get(id);
    const text = el ? nodeTextOf(el) : null;
    if (!el || !text) return null;
    const node: TopoNode = { id, label: text.label || "Component", kind: kindOf(text), text, callers: new Set(), callees: new Set(), copies: declaredCopies(text), redundantByNature: isInherentlyRedundant(text) };
    nodes.set(id, node);
    return node;
  };

  const edges: Topology["edges"] = [];
  for (const el of els) {
    if (el.type !== "connector" || !el.start || !el.end) continue;
    const a = ensure(el.start.id);
    const b = ensure(el.end.id);
    if (!a || !b || a.id === b.id) continue;
    for (const dir of flowDirections(el)) {
      const [from, to] = dir === "forward" ? [a, b] : [b, a];
      from.callees.add(to.id);
      to.callers.add(from.id);
      edges.push({ id: el.id, from: from.id, to: to.id });
    }
  }

  // "API 1" / "API 2" drawn as separate boxes are replicas of each other.
  const families = new Map<string, TopoNode[]>();
  for (const n of nodes.values()) {
    const key = `${n.kind}:${familyKey(n.label)}`;
    if (!familyKey(n.label)) continue;
    families.set(key, [...(families.get(key) ?? []), n]);
  }
  for (const group of families.values()) {
    if (group.length < 2) continue;
    for (const n of group) n.copies = Math.max(n.copies, group.length);
  }
  return { nodes, edges };
}

/** Nodes whose removal disconnects the undirected graph (Tarjan's articulation points), iterative. */
export function articulationPoints(topo: Topology): Set<string> {
  const adj = new Map<string, string[]>();
  for (const n of topo.nodes.values()) adj.set(n.id, Array.from(new Set([...n.callers, ...n.callees])));
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const result = new Set<string>();
  let time = 0;

  for (const root of adj.keys()) {
    if (disc.has(root)) continue;
    let rootChildren = 0;
    disc.set(root, ++time);
    low.set(root, time);
    const stack: { id: string; parent: string | null; i: number }[] = [{ id: root, parent: null, i: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbours = adj.get(frame.id) ?? [];
      if (frame.i < neighbours.length) {
        const next = neighbours[frame.i++];
        if (next === frame.parent) continue;
        if (disc.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, disc.get(next)!));
        } else {
          disc.set(next, ++time);
          low.set(next, time);
          if (frame.parent === null) rootChildren++;
          stack.push({ id: next, parent: frame.id, i: 0 });
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
          if (parent.parent !== null && low.get(frame.id)! >= disc.get(parent.id)!) result.add(parent.id);
        }
      }
    }
    if (rootChildren > 1) result.add(root);
  }
  return result;
}

export interface Spof {
  id: string;
  label: string;
  kind: NodeKind;
  dependents: number;
  /** Extra copies beyond the one drawn. */
  replicas: number;
  severity: "high" | "medium";
  message: string;
}

const STATEFUL: NodeKind[] = ["database", "cache", "queue", "storage", "auth"];
const ROUTING: NodeKind[] = ["gateway", "loadbalancer", "auth", "edge"];

/** Components that many others depend on and that have no redundancy. Highest severity first. */
export function findSpofs(els: El[]): Spof[] {
  const topo = buildTopology(els);
  if (topo.nodes.size < 2) return [];
  const cuts = articulationPoints(topo);
  const out: Spof[] = [];

  for (const n of topo.nodes.values()) {
    if (n.kind === "client" || n.kind === "monitoring") continue;
    if (n.copies > 1 || n.redundantByNature) continue;
    const dependents = n.callers.size;
    if (dependents === 0) continue; // an entry point, not something others rely on
    const stateful = STATEFUL.includes(n.kind);
    const routing = ROUTING.includes(n.kind);
    const downstream = n.callees.size;

    let severity: Spof["severity"] | null = null;
    if (dependents >= 3 || (stateful && dependents >= 2) || (routing && dependents >= 1 && downstream >= 2)) severity = "high";
    else if (dependents >= 2 || stateful || (cuts.has(n.id) && downstream >= 1)) severity = "medium";
    if (!severity) continue;

    const replicas = n.copies - 1;
    out.push({
      id: n.id,
      label: n.label,
      kind: n.kind,
      dependents,
      replicas,
      severity,
      message: `${n.label} has ${dependents} dependent ${dependents === 1 ? "client" : "clients"} and ${replicas} ${replicas === 1 ? "replica" : "replicas"}`,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.dependents - a.dependents : a.severity === "high" ? -1 : 1)).slice(0, 12);
}
