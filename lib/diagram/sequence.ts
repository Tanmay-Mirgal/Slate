import { cardSize } from "../canvas/create";
import { measureWidth, textFont } from "../canvas/text";
import { accentFromName } from "../canvas/theme";
import type { CardEl, ConnectorEl, El } from "../canvas/types";
import type { Graph } from "./graph";
import type { LayoutResult } from "./layout";

const ROW = 60;
const TOP_GAP = 54;
const MIN_GAP = 56;

/** Participants across the top, dashed lifelines, and time-ordered message arrows. */
export function layoutSequence(graph: Graph, diagramId: string): LayoutResult {
  const t0 = Date.now();
  const people = graph.nodes;
  const messages = graph.messages ?? [];
  const index = new Map(people.map((p, i) => [p.id, i]));
  const sizes = people.map((p) => cardSize(p.label, p.subtitle, true));
  const labelFont = textFont({ size: 12, bold: true });

  // minimum horizontal distance between neighbouring lifelines
  const gap = people.slice(0, -1).map((_, i) => (sizes[i].w + sizes[i + 1].w) / 2 + MIN_GAP);
  for (const m of messages) {
    const a = index.get(m.from);
    const b = index.get(m.to);
    if (a === undefined || b === undefined || a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const need = measureWidth(m.label, labelFont) + 56;
    let have = 0;
    for (let i = lo; i < hi; i++) have += gap[i];
    if (have < need) gap[hi - 1] += need - have;
  }
  const centers: number[] = [];
  let x = sizes[0] ? sizes[0].w / 2 : 0;
  people.forEach((_, i) => {
    centers.push(x);
    if (i < people.length - 1) x += gap[i];
  });

  const headerH = Math.max(...sizes.map((s) => s.h), 64);
  const lastY = headerH + TOP_GAP + Math.max(0, messages.length) * ROW;
  const bottom = lastY + 24;
  const elements: El[] = [];

  people.forEach((p, i) => {
    const s = sizes[i];
    const card: CardEl = {
      id: `${diagramId}:${p.id}`,
      type: "card",
      x: Math.round(centers[i] - s.w / 2),
      y: 0,
      w: s.w,
      h: headerH,
      z: 100 + i,
      title: p.label,
      ...(p.subtitle ? { subtitle: p.subtitle } : {}),
      icon: p.icon ?? "lucide:Box",
      ...(p.color ? { accent: accentFromName(p.color) } : {}),
      diagramId,
    };
    elements.push(card);
    const life: ConnectorEl = {
      id: `${diagramId}:life:${p.id}`,
      type: "connector",
      x: centers[i],
      y: headerH,
      w: 0,
      h: bottom - headerH,
      z: 10,
      points: [
        { x: centers[i], y: headerH },
        { x: centers[i], y: bottom },
      ],
      route: "straight",
      startHead: "none",
      endHead: "none",
      stroke: "muted",
      strokeWidth: 1.25,
      dash: "dashed",
      opacity: 0.7,
      diagramId,
    };
    elements.push(life);
  });

  messages.forEach((m, i) => {
    const a = index.get(m.from);
    const b = index.get(m.to);
    if (a === undefined || b === undefined) return;
    const y = headerH + TOP_GAP + i * ROW;
    const self = a === b;
    const pts = self
      ? [
          { x: centers[a], y },
          { x: centers[a] + 44, y },
          { x: centers[a] + 44, y: y + 26 },
          { x: centers[a], y: y + 26 },
        ]
      : [
          { x: centers[a], y },
          { x: centers[b], y },
        ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const conn: ConnectorEl = {
      id: `${diagramId}:m${i}`,
      type: "connector",
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      z: 20 + i * 0.001,
      points: pts,
      route: "straight",
      startHead: "none",
      endHead: m.kind === "sync" || !m.kind ? "triangle" : "arrow",
      stroke: m.kind === "return" ? "muted" : "ink",
      strokeWidth: 1.75,
      ...(m.kind === "return" ? { dash: "dashed" as const } : {}),
      label: m.label,
      labelT: self ? 0.5 : 0.5,
      diagramId,
    };
    elements.push(conn);
  });

  const width = (centers.length ? centers[centers.length - 1] + sizes[sizes.length - 1].w / 2 : 0) + 60;
  return {
    elements,
    bounds: { x: 0, y: 0, w: Math.max(width, 200), h: bottom },
    direction: "sequence",
    diagramId,
    members: new Map(),
    ms: Date.now() - t0,
  };
}
