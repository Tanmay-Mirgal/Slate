import type { ELK as ElkInstance, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import { cardSize, createFrame } from "../canvas/create";
import { fractionOfClosest, rectsOverlap } from "../canvas/geometry";
import { newId } from "../canvas/ids";
import { anchorFor, routeSignature } from "../canvas/router";
import { LINE_HEIGHT, measureWidth, textFont, wrapLines } from "../canvas/text";
import { ACCENTS, accentFromName } from "../canvas/theme";
import type { CardEl, ConnectorEl, El, Point, Rect, ShapeEl, ShapeKind, Side, TableEl } from "../canvas/types";
import { descendantsOf, type FlowShape, type GEdge, type GGroup, type GNode, type Graph } from "./graph";
import { layoutSequence } from "./sequence";

let elk: ElkInstance | null = null;
/** ELK is ~1.3 MB, so it is loaded on first use (and never on pages that don't draw diagrams). */
async function getElk(): Promise<ElkInstance> {
  if (!elk) {
    const mod = await import("elkjs/lib/elk.bundled.js");
    const Ctor = (mod as unknown as { default: new () => ElkInstance }).default;
    elk = new Ctor();
  }
  return elk;
}

export interface LayoutOptions {
  /** Prefix for generated element ids and the `diagramId` tag. */
  diagramId?: string;
  /** Extra breathing room multiplier (1 = default). */
  spacing?: number;
}

export interface LayoutResult {
  elements: El[];
  bounds: Rect;
  direction: "down" | "right" | "radial" | "sequence";
  diagramId: string;
  /** frame element id -> ids of every node element inside it (for validation and revisions). */
  members: Map<string, Set<string>>;
  ms: number;
}

const FRAME_COLORS = [ACCENTS.blue, ACCENTS.green, ACCENTS.purple, ACCENTS.orange, ACCENTS.teal, ACCENTS.pink, ACCENTS.indigo, ACCENTS.yellow];

/* --------------------------------------------------------------------- sizing */

const FLOW_KIND: Record<FlowShape, ShapeKind> = {
  process: "rect",
  decision: "diamond",
  terminator: "stadium",
  io: "parallelogram",
  data: "cylinder",
  document: "document",
  cloud: "cloud",
  hexagon: "hexagon",
  note: "rect",
};

function flowSize(kind: FlowShape, label: string, fontSize: number): { w: number; h: number; lines: number } {
  const font = textFont({ size: fontSize });
  const maxText = kind === "decision" ? 190 : 210;
  const lines = wrapLines(label, font, maxText).length;
  let widest = 0;
  for (const l of wrapLines(label, font, maxText)) widest = Math.max(widest, measureWidth(l, font));
  const textH = lines * fontSize * LINE_HEIGHT;
  switch (kind) {
    case "decision":
      return { w: Math.max(150, Math.round((widest + 40) * 1.55)), h: Math.max(100, Math.round((textH + 24) * 1.7)), lines };
    case "terminator":
      return { w: Math.max(140, Math.round(widest + 56)), h: Math.max(56, Math.round(textH + 28)), lines };
    case "io":
      return { w: Math.max(170, Math.round(widest + 90)), h: Math.max(66, Math.round(textH + 30)), lines };
    case "data":
      return { w: Math.max(130, Math.round(widest + 40)), h: Math.max(110, Math.round(textH + 78)), lines };
    case "cloud":
      return { w: Math.max(170, Math.round(widest + 90)), h: Math.max(110, Math.round(textH + 70)), lines };
    default:
      return { w: Math.max(150, Math.round(widest + 48)), h: Math.max(64, Math.round(textH + 30)), lines };
  }
}

function tableSize(n: GNode): { w: number; h: number } {
  const cols = n.fields ?? [];
  const nameFont = textFont({ size: 12.5 });
  const typeFont = textFont({ size: 11, family: "mono" });
  let w = measureWidth(n.label, textFont({ size: 13, bold: true })) + 40;
  for (const c of cols) w = Math.max(w, measureWidth(c.name, nameFont) + (c.type ? measureWidth(c.type, typeFont) : 0) + (cols.some((x) => x.key) ? 24 : 0) + 44);
  return { w: Math.round(Math.max(200, Math.min(380, w)) / 4) * 4, h: 34 + cols.length * 26 + 6 };
}

interface Sized {
  node: GNode;
  w: number;
  h: number;
  make: (x: number, y: number, z: number) => El;
  boxLike: boolean;
}

function sizeNode(n: GNode, kind: Graph["kind"], diagramId: string, accentFor: (n: GNode) => string | undefined): Sized {
  const id = `${diagramId}:${n.id}`;
  const accent = accentFor(n);
  if (kind === "erd" && n.fields?.length) {
    const { w, h } = tableSize(n);
    return {
      node: n,
      w,
      h,
      boxLike: true,
      make: (x, y, z): TableEl => ({ id, type: "table", x, y, w, h, z, title: n.label, columns: n.fields!, accent, diagramId }),
    };
  }
  if (kind === "flowchart" || kind === "mindmap") {
    const shape: FlowShape = n.shape ?? (kind === "mindmap" ? "terminator" : "process");
    const fontSize = kind === "mindmap" ? 16 : 15;
    const { w, h } = flowSize(shape, n.label, fontSize);
    const shapeKind = FLOW_KIND[shape];
    const fillAccent = accent ?? (shape === "decision" ? ACCENTS.yellow : shape === "terminator" ? ACCENTS.green : undefined);
    const make = (x: number, y: number, z: number): ShapeEl => ({
      id,
      type: "shape",
      shape: shapeKind,
      x,
      y,
      w,
      h,
      z,
      text: n.label,
      fontSize,
      font: "sans",
      align: "center",
      stroke: fillAccent ?? "ink",
      fill: fillAccent ? `${fillAccent}26` : "surface",
      strokeWidth: 1.75,
      ...(shape === "note" ? { dash: "dashed" as const } : {}),
      ...(shapeKind === "rect" ? { radius: 10 } : {}),
      diagramId,
    });
    return { node: n, w, h, boxLike: shapeKind === "rect" || shapeKind === "document" || shapeKind === "cylinder", make };
  }
  const icon = n.icon ?? "lucide:Box";
  const { w, h } = cardSize(n.label, n.subtitle, true);
  return {
    node: n,
    w,
    h,
    boxLike: true,
    make: (x, y, z): CardEl => ({
      id,
      type: "card",
      x,
      y,
      w,
      h,
      z,
      title: n.label,
      ...(n.subtitle ? { subtitle: n.subtitle } : {}),
      icon,
      ...(accent ? { accent } : {}),
      diagramId,
    }),
  };
}

/* ------------------------------------------------------------------ ELK build */

const spacingOpts = (k: number, dir: "DOWN" | "RIGHT") => ({
  "elk.spacing.nodeNode": String(Math.round(56 * k)),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(Math.round((dir === "DOWN" ? 96 : 120) * k)),
  "elk.spacing.edgeNode": String(Math.round(26 * k)),
  "elk.spacing.edgeEdge": String(Math.round(18 * k)),
  "elk.layered.spacing.edgeNodeBetweenLayers": String(Math.round(26 * k)),
  "elk.layered.spacing.edgeEdgeBetweenLayers": String(Math.round(18 * k)),
  "elk.spacing.edgeLabel": "6",
});

function buildElk(graph: Graph, sized: Map<string, Sized>, dir: "DOWN" | "RIGHT", k: number, diagramId: string): ElkNode {
  const common = {
    "elk.algorithm": "layered",
    "elk.direction": dir,
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.nodePlacement.favorStraightEdges": "true",
    ...spacingOpts(k, dir),
  };
  const groupById = new Map(graph.groups.map((g) => [g.id, g]));
  const groupNode = (g: GGroup): ElkNode => ({
    id: `g:${g.id}`,
    layoutOptions: { ...common, "elk.padding": `[top=${Math.round(46 * k)},left=${Math.round(26 * k)},bottom=${Math.round(26 * k)},right=${Math.round(26 * k)}]` },
    children: [
      ...graph.groups.filter((c) => c.parent === g.id).map(groupNode),
      ...graph.nodes.filter((n) => n.group === g.id).map(leaf),
    ],
  });
  const leaf = (n: GNode): ElkNode => {
    const s = sized.get(n.id)!;
    return { id: `n:${n.id}`, width: s.w, height: s.h };
  };
  const roots = graph.groups.filter((g) => !g.parent || !groupById.has(g.parent));
  const children: ElkNode[] = [...roots.map(groupNode), ...graph.nodes.filter((n) => !n.group).map(leaf)];

  const font = textFont({ size: 11.5, bold: true });
  const edges: ElkExtendedEdge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    sources: [`n:${e.from}`],
    targets: [`n:${e.to}`],
    ...(e.label ? { labels: [{ id: `e${i}l`, text: e.label, width: Math.min(240, measureWidth(e.label, font) + 18), height: 22 }] } : {}),
  }));

  return {
    id: diagramId,
    layoutOptions: {
      ...common,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      "org.eclipse.elk.json.edgeCoords": "ROOT",
      "org.eclipse.elk.json.shapeCoords": "ROOT",
    },
    children,
    edges,
  };
}

/* ------------------------------------------------------------------ results */

function sideAndT(rect: Rect, p: Point): { side: Side; t: number } {
  const d = {
    left: Math.abs(p.x - rect.x),
    right: Math.abs(p.x - (rect.x + rect.w)),
    top: Math.abs(p.y - rect.y),
    bottom: Math.abs(p.y - (rect.y + rect.h)),
  };
  const side = (Object.keys(d) as Side[]).reduce((a, b) => (d[b] < d[a] ? b : a));
  const t = side === "left" || side === "right" ? (p.y - rect.y) / Math.max(1, rect.h) : (p.x - rect.x) / Math.max(1, rect.w);
  return { side, t: Math.min(0.92, Math.max(0.08, t)) };
}

function aspectScore(w: number, h: number): number {
  return Math.abs(Math.log(w / Math.max(1, h) / 1.55));
}

interface Pass {
  dir: "DOWN" | "RIGHT";
  out: ElkNode;
  score: number;
}

async function runElk(graph: Graph, sized: Map<string, Sized>, dir: "DOWN" | "RIGHT", k: number, diagramId: string): Promise<Pass> {
  const out = (await (await getElk()).layout(buildElk(graph, sized, dir, k, diagramId))) as ElkNode;
  return { dir, out, score: aspectScore(out.width ?? 1, out.height ?? 1) };
}

function walk(n: ElkNode, fn: (n: ElkNode) => void) {
  fn(n);
  for (const c of n.children ?? []) walk(c, fn);
}

/** Lays out architecture / flowchart / ERD / mind-map graphs and returns ready-to-insert elements. */
export async function layoutGraph(graph: Graph, opts: LayoutOptions = {}): Promise<LayoutResult> {
  const t0 = Date.now();
  const diagramId = opts.diagramId ?? newId("dg");
  if (graph.kind === "sequence") return layoutSequence(graph, diagramId);

  const k = opts.spacing ?? 1;
  const groupColor = new Map<string, string>();
  graph.groups.forEach((g, i) => groupColor.set(g.id, g.color ? accentFromName(g.color) : FRAME_COLORS[i % FRAME_COLORS.length]));
  const accentFor = (n: GNode): string | undefined => (n.color ? accentFromName(n.color) : undefined);

  const sized = new Map<string, Sized>();
  for (const n of graph.nodes) sized.set(n.id, sizeNode(n, graph.kind, diagramId, accentFor));

  // direction: honour an explicit choice, otherwise try both and keep the better aspect ratio
  let pass: Pass;
  if (graph.kind === "mindmap") {
    pass = await runRadial(graph, sized, k, diagramId);
  } else if (graph.direction === "down" || graph.direction === "right") {
    pass = await runElk(graph, sized, graph.direction === "down" ? "DOWN" : "RIGHT", k, diagramId);
  } else if (graph.nodes.length > 60) {
    pass = await runElk(graph, sized, "RIGHT", k, diagramId);
  } else {
    const [down, right] = await Promise.all([runElk(graph, sized, "DOWN", k, diagramId), runElk(graph, sized, "RIGHT", k, diagramId)]);
    // flowcharts read top-to-bottom: only switch if the aspect ratio is clearly bad
    const bias = graph.kind === "flowchart" ? 0.45 : 0;
    pass = right.score + bias < down.score ? right : down;
  }

  const result = convert(graph, sized, pass, diagramId, groupColor);
  result.ms = Date.now() - t0;
  return result;
}

async function runRadial(graph: Graph, sized: Map<string, Sized>, k: number, diagramId: string): Promise<Pass> {
  const children: ElkNode[] = graph.nodes.map((n) => {
    const s = sized.get(n.id)!;
    return { id: `n:${n.id}`, width: s.w, height: s.h };
  });
  const edges: ElkExtendedEdge[] = graph.edges.map((e, i) => ({ id: `e${i}`, sources: [`n:${e.from}`], targets: [`n:${e.to}`] }));
  const root: ElkNode = {
    id: diagramId,
    layoutOptions: {
      "elk.algorithm": "radial",
      "elk.spacing.nodeNode": String(Math.round(46 * k)),
      "elk.radial.radius": String(Math.round(150 * k)),
      "elk.radial.compaction.strategy": "RADIAL_COMPACTION",
      "elk.radial.orderId": "0",
      "org.eclipse.elk.json.edgeCoords": "ROOT",
      "org.eclipse.elk.json.shapeCoords": "ROOT",
    },
    children,
    edges,
  };
  const out = (await (await getElk()).layout(root)) as ElkNode;
  return { dir: "RIGHT", out, score: 0 };
}

function convert(graph: Graph, sized: Map<string, Sized>, pass: Pass, diagramId: string, groupColor: Map<string, string>): LayoutResult {
  const out = pass.out;
  const elements: El[] = [];
  const rects = new Map<string, Rect>(); // node id -> rect
  const els = new Map<string, El>(); // node id -> element
  const members = new Map<string, Set<string>>();

  // groups -> frames (outermost first so nested ones paint above)
  const frames: { g: GGroup; rect: Rect; depth: number }[] = [];
  walk(out, (n) => {
    if (!n.id.startsWith("g:")) return;
    const g = graph.groups.find((x) => `g:${x.id}` === n.id);
    if (!g) return;
    let depth = 0;
    for (let p = g.parent; p; p = graph.groups.find((x) => x.id === p)?.parent) depth++;
    frames.push({ g, rect: { x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 0, h: n.height ?? 0 }, depth });
  });
  frames.sort((a, b) => a.depth - b.depth);
  const frameEl = new Map<string, string>();
  frames.forEach(({ g, rect, depth }) => {
    const f = createFrame(rect, 1 + depth, g.label);
    f.id = `${diagramId}:g:${g.id}`;
    f.diagramId = diagramId;
    f.accent = groupColor.get(g.id);
    elements.push(f);
    frameEl.set(g.id, f.id);
  });

  // nodes
  const NODE_Z = 100;
  walk(out, (n) => {
    if (!n.id.startsWith("n:")) return;
    const id = n.id.slice(2);
    const s = sized.get(id);
    if (!s) return;
    const el = s.make(Math.round(n.x ?? 0), Math.round(n.y ?? 0), NODE_Z + elements.length);
    elements.push(el);
    els.set(id, el);
    rects.set(id, { x: el.x, y: el.y, w: el.w, h: el.h });
  });

  for (const g of graph.groups) {
    const ds = descendantsOf(graph.groups, g.id);
    const set = new Set<string>();
    for (const n of graph.nodes) if (n.group && ds.has(n.group)) set.add(`${diagramId}:${n.id}`);
    members.set(`${diagramId}:g:${g.id}`, set);
  }

  // edges -> connectors
  const edgeById = new Map<string, ElkExtendedEdge>();
  for (const e of out.edges ?? []) edgeById.set(e.id, e);
  walk(out, (n) => {
    for (const e of n.edges ?? []) edgeById.set(e.id, e);
  });
  const CONN_Z = 50;
  graph.edges.forEach((e: GEdge, i) => {
    const a = els.get(e.from);
    const b = els.get(e.to);
    if (!a || !b) return;
    const sa = sized.get(e.from)!;
    const sb = sized.get(e.to)!;
    const elkEdge = edgeById.get(`e${i}`);
    const section = elkEdge?.sections?.[0];
    const arrow = e.arrow ?? "forward";
    const conn: ConnectorEl = {
      id: `${diagramId}:e${i}`,
      type: "connector",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      z: CONN_Z + i * 0.001,
      points: [],
      start: { id: a.id },
      end: { id: b.id },
      route: graph.kind === "mindmap" ? "curve" : "elbow",
      startHead: arrow === "both" || arrow === "back" ? "arrow" : "none",
      endHead: arrow === "none" || arrow === "back" ? "none" : "arrow",
      stroke: "muted",
      strokeWidth: 1.75,
      ...(e.style && e.style !== "solid" ? { dash: e.style } : {}),
      ...(e.label ? { label: e.label } : {}),
      diagramId,
    };
    if (section && sa.boxLike && sb.boxLike && graph.kind !== "mindmap") {
      const raw = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      const s0 = sideAndT(rects.get(e.from)!, raw[0]);
      const s1 = sideAndT(rects.get(e.to)!, raw[raw.length - 1]);
      conn.start = { id: a.id, side: s0.side, t: s0.t };
      conn.end = { id: b.id, side: s1.side, t: s1.t };
      const p0 = anchorFor(a, s0.side, s0.t);
      const p1 = anchorFor(b, s1.side, s1.t);
      const pts: Point[] = [p0, ...raw.slice(1, -1).map((p) => ({ x: p.x, y: p.y })), p1];
      // keep the first / last segment axis-aligned after snapping endpoints onto the anchors
      if (pts.length >= 3) {
        const horizFirst = Math.abs(raw[0].y - raw[1].y) < 0.5;
        if (horizFirst) pts[1] = { x: pts[1].x, y: p0.y };
        else pts[1] = { x: p0.x, y: pts[1].y };
        const m = pts.length - 2;
        const horizLast = Math.abs(raw[raw.length - 1].y - raw[raw.length - 2].y) < 0.5;
        if (horizLast) pts[m] = { x: pts[m].x, y: p1.y };
        else pts[m] = { x: p1.x, y: pts[m].y };
      }
      conn.points = pts;
      conn.routeSig = routeSignature(p0, p1, "elbow");
      const lab = elkEdge?.labels?.[0];
      if (lab && lab.x !== undefined && lab.y !== undefined && e.label) {
        const center = { x: lab.x + (lab.width ?? 0) / 2, y: lab.y + (lab.height ?? 0) / 2 };
        conn.labelT = Math.min(0.85, Math.max(0.15, fractionOfClosest(pts, center)));
      }
    } else {
      conn.start = { id: a.id };
      conn.end = { id: b.id };
      conn.points = [
        { x: a.x + a.w / 2, y: a.y + a.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      ];
    }
    const xs = conn.points.map((p) => p.x);
    const ys = conn.points.map((p) => p.y);
    conn.x = Math.min(...xs);
    conn.y = Math.min(...ys);
    conn.w = Math.max(...xs) - conn.x;
    conn.h = Math.max(...ys) - conn.y;
    elements.push(conn);
  });

  const all = Array.from(rects.values());
  const fr = frames.map((f) => f.rect);
  const union = [...all, ...fr];
  const x1 = Math.min(...union.map((r) => r.x));
  const y1 = Math.min(...union.map((r) => r.y));
  const x2 = Math.max(...union.map((r) => r.x + r.w));
  const y2 = Math.max(...union.map((r) => r.y + r.h));
  const bounds = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };

  // normalise to the origin so callers can place the diagram anywhere
  const shifted = elements.map((el) => shiftElement(el, -x1, -y1));
  return {
    elements: shifted,
    bounds: { x: 0, y: 0, w: bounds.w, h: bounds.h },
    direction: graph.kind === "mindmap" ? "radial" : pass.dir === "DOWN" ? "down" : "right",
    diagramId,
    members,
    ms: 0,
  };
}

export function shiftElement(el: El, dx: number, dy: number): El {
  if (el.type === "connector") {
    const c: ConnectorEl = {
      ...el,
      x: el.x + dx,
      y: el.y + dy,
      points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    };
    if (el.routeSig) {
      const m = el.routeSig.match(/^(-?[\d.]+),(-?[\d.]+)>(-?[\d.]+),(-?[\d.]+):(.+)$/);
      if (m) {
        const r = (v: number) => Math.round(v * 2) / 2;
        c.routeSig = `${r(+m[1] + dx)},${r(+m[2] + dy)}>${r(+m[3] + dx)},${r(+m[4] + dy)}:${m[5]}`;
      }
    }
    return c;
  }
  return { ...el, x: el.x + dx, y: el.y + dy } as El;
}

/* ------------------------------------------------------------------ validation */

export interface Overlap {
  a: string;
  b: string;
  kind: "node-node" | "frame-node" | "frame-frame";
}

const isNode = (el: El) => el.type !== "connector" && el.type !== "frame" && el.type !== "pen";

/** Geometric audit of a generated diagram: used by tests and as a runtime safety net. */
export function findOverlaps(result: LayoutResult, gap = 4): Overlap[] {
  const out: Overlap[] = [];
  const els = result.elements;
  const nodes = els.filter(isNode);
  const frames = els.filter((e) => e.type === "frame");
  const rect = (e: El): Rect => ({ x: e.x, y: e.y, w: e.w, h: e.h });
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (rectsOverlap(rect(nodes[i]), rect(nodes[j]), gap)) out.push({ a: nodes[i].id, b: nodes[j].id, kind: "node-node" });
    }
  }
  for (const f of frames) {
    const inside = result.members.get(f.id) ?? new Set<string>();
    for (const n of nodes) {
      const overlaps = rectsOverlap(rect(f), rect(n), 0);
      if (inside.has(n.id)) {
        // members must be fully contained
        const r = rect(n);
        const fr = rect(f);
        if (r.x < fr.x || r.y < fr.y || r.x + r.w > fr.x + fr.w || r.y + r.h > fr.y + fr.h) out.push({ a: f.id, b: n.id, kind: "frame-node" });
      } else if (overlaps) out.push({ a: f.id, b: n.id, kind: "frame-node" });
    }
    for (const g of frames) {
      if (g.id <= f.id) continue;
      const fm = result.members.get(f.id) ?? new Set<string>();
      const gm = result.members.get(g.id) ?? new Set<string>();
      const nested = [...gm].every((id) => fm.has(id)) || [...fm].every((id) => gm.has(id));
      if (!nested && rectsOverlap(rect(f), rect(g), 0)) out.push({ a: f.id, b: g.id, kind: "frame-frame" });
    }
  }
  return out;
}

/** A node pair's label / icon lookups used by callers that want a quick summary. */
export function describeLayout(result: LayoutResult): string {
  const n = result.elements.filter(isNode).length;
  const e = result.elements.filter((x) => x.type === "connector").length;
  const f = result.elements.filter((x) => x.type === "frame").length;
  return `${n} nodes, ${e} connections, ${f} groups (${result.direction}) in ${result.ms}ms`;
}

