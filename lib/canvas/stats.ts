import type { El } from "./types";

export interface BoardStats {
  nodes: number;
  connectors: number;
}

/** Element types that count as a "node" on a dashboard card: the things a diagram is made of, not its labels, frames or scribbles. */
const NODE_TYPES = new Set<El["type"]>(["shape", "card", "icon", "table", "sticky", "image"]);

export function boardStats(els: Iterable<El>): BoardStats {
  let nodes = 0;
  let connectors = 0;
  for (const el of els) {
    if (el.type === "connector") connectors++;
    else if (NODE_TYPES.has(el.type)) nodes++;
  }
  return { nodes, connectors };
}
