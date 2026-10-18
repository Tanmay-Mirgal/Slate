import { guessIcon, isValidIconKey, findIconDef } from "../canvas/icons-catalog";
import { accentFromName } from "../canvas/theme";
import type { TableColumn } from "../canvas/types";

/**
 * Semantic diagram description shared by AI generation, the diagram-as-code DSL and the layout
 * engine. It never contains coordinates: layout is computed, so generated diagrams can't overlap.
 */

export type DiagramKind = "architecture" | "flowchart" | "mindmap" | "erd" | "sequence";
export const DIAGRAM_KINDS: DiagramKind[] = ["architecture", "flowchart", "mindmap", "erd", "sequence"];

export type FlowShape = "process" | "decision" | "terminator" | "io" | "data" | "document" | "cloud" | "hexagon" | "note";
export const FLOW_SHAPES: FlowShape[] = ["process", "decision", "terminator", "io", "data", "document", "cloud", "hexagon", "note"];

export interface GNode {
  id: string;
  label: string;
  subtitle?: string;
  icon?: string;
  shape?: FlowShape;
  color?: string;
  group?: string;
  fields?: TableColumn[];
}

export interface GGroup {
  id: string;
  label: string;
  parent?: string;
  color?: string;
  icon?: string;
}

export type EdgeStyle = "solid" | "dashed" | "dotted";
export type EdgeArrow = "forward" | "back" | "both" | "none";

export interface GEdge {
  from: string;
  to: string;
  label?: string;
  style?: EdgeStyle;
  arrow?: EdgeArrow;
}

export interface GMessage {
  from: string;
  to: string;
  label: string;
  kind?: "sync" | "async" | "return";
}

export interface Graph {
  kind: DiagramKind;
  title?: string;
  direction?: "down" | "right" | "auto";
  nodes: GNode[];
  groups: GGroup[];
  edges: GEdge[];
  /** Sequence diagrams: ordered messages between `nodes` (participants). */
  messages?: GMessage[];
}

export const LIMITS = { nodes: 90, groups: 16, edges: 200, messages: 60, label: 90, subtitle: 140, fields: 14 };

const clip = (s: unknown, n: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const first = (...vals: unknown[]): unknown => vals.find((v) => v !== undefined && v !== null && v !== "");

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "n"
  );
}

/** Turns "postgres", "aws-s3", "Server", "lucide:Server" into a valid icon key (or undefined). */
export function resolveIconName(value: unknown, fallbackText?: string): string | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw) {
    if (raw.includes(":") && isValidIconKey(raw)) return raw;
    const lower = raw.toLowerCase();
    for (const key of [`svc:${lower}`, `brand:${lower}`, `brand:${lower.replace(/[.\s-]/g, "")}`]) if (findIconDef(key)) return key;
    const pascal = raw.replace(/(^|[-_\s])(\w)/g, (_, __, c: string) => c.toUpperCase());
    if (isValidIconKey(`lucide:${pascal}`) && findIconDef(`lucide:${pascal}`)) return `lucide:${pascal}`;
    const guessed = guessIcon(raw);
    if (guessed) return guessed;
  }
  return fallbackText ? guessIcon(fallbackText) : undefined;
}

function normalizeFields(v: unknown): TableColumn[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TableColumn[] = [];
  for (const f of v.slice(0, LIMITS.fields)) {
    if (typeof f === "string") {
      const m = f.trim().split(/\s+/);
      if (m[0]) out.push({ name: clip(m[0], 40), type: m[1] ? clip(m[1], 24) : undefined, key: keyOf(m[2]) });
    } else if (f && typeof f === "object") {
      const o = f as Record<string, unknown>;
      const name = clip(first(o.name, o.field, o.column), 40);
      if (name) out.push({ name, type: clip(first(o.type, o.datatype), 24) || undefined, key: keyOf(first(o.key, o.constraint, o.pk && "pk", o.fk && "fk")) });
    }
  }
  return out.length ? out : undefined;
}

function keyOf(v: unknown): TableColumn["key"] | undefined {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "pk" || s === "primary" || s === "primary key") return "pk";
  if (s === "fk" || s === "foreign" || s === "foreign key") return "fk";
  if (s === "unique" || s === "uq") return "unique";
  return undefined;
}

const SHAPE_ALIASES: Record<string, FlowShape> = {
  start: "terminator",
  end: "terminator",
  stop: "terminator",
  terminal: "terminator",
  oval: "terminator",
  rect: "process",
  rectangle: "process",
  step: "process",
  action: "process",
  task: "process",
  condition: "decision",
  diamond: "decision",
  if: "decision",
  input: "io",
  output: "io",
  parallelogram: "io",
  database: "data",
  db: "data",
  cylinder: "data",
  doc: "document",
  file: "document",
  report: "document",
  subprocess: "process",
};

function shapeOf(v: unknown): FlowShape | undefined {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  if ((FLOW_SHAPES as string[]).includes(s)) return s as FlowShape;
  return SHAPE_ALIASES[s];
}

export interface NormalizeResult {
  graph: Graph;
  warnings: string[];
}

/**
 * Accepts whatever shape an LLM (or a hand-written file) produced and returns a clean, bounded,
 * internally consistent Graph: unique ids, valid group tree, no dangling edges, capped sizes.
 */
export function normalizeGraph(raw: unknown, fallbackKind: DiagramKind = "architecture"): NormalizeResult {
  const warnings: string[] = [];
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kindRaw = typeof src.kind === "string" ? src.kind : typeof src.diagramType === "string" ? src.diagramType : typeof src.type === "string" ? src.type : "";
  const kindGuess = kindRaw.toLowerCase();
  const kind: DiagramKind = (DIAGRAM_KINDS as string[]).includes(kindGuess)
    ? (kindGuess as DiagramKind)
    : /flow/.test(kindGuess)
      ? "flowchart"
      : /erd|entity|er diagram|schema/.test(kindGuess)
        ? "erd"
        : /mind/.test(kindGuess)
          ? "mindmap"
          : /seq/.test(kindGuess)
            ? "sequence"
            : fallbackKind;

  // ---- groups
  const groupsIn = Array.isArray(src.groups) ? src.groups : Array.isArray(src.clusters) ? src.clusters : [];
  const groups: GGroup[] = [];
  const groupIds = new Map<string, string>(); // any alias -> canonical id
  for (const g of groupsIn.slice(0, LIMITS.groups)) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const label = clip(first(o.label, o.title, o.name, o.id), LIMITS.label);
    if (!label) continue;
    let id = slug(String(first(o.id, label)));
    while (groups.some((x) => x.id === id)) id += "_";
    groupIds.set(String(first(o.id, label)).toLowerCase(), id);
    groupIds.set(label.toLowerCase(), id);
    groupIds.set(id, id);
    groups.push({
      id,
      label,
      parent: typeof first(o.parent, o.parentId) === "string" ? String(first(o.parent, o.parentId)) : undefined,
      color: typeof o.color === "string" ? o.color : undefined,
      icon: resolveIconName(o.icon, label),
    });
  }
  for (const g of groups) {
    const p = g.parent ? groupIds.get(g.parent.toLowerCase()) : undefined;
    g.parent = p && p !== g.id ? p : undefined;
  }
  // break parent cycles
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let cur = g.parent;
    while (cur) {
      if (seen.has(cur)) {
        g.parent = undefined;
        warnings.push(`Group "${g.label}" had a circular parent; flattened.`);
        break;
      }
      seen.add(cur);
      cur = groups.find((x) => x.id === cur)?.parent;
    }
  }

  // ---- nodes
  const nodesIn = Array.isArray(src.nodes) ? src.nodes : Array.isArray(src.entities) ? src.entities : Array.isArray(src.participants) ? src.participants : [];
  const nodes: GNode[] = [];
  const nodeKey = new Map<string, string>(); // alias -> canonical id
  for (const n of nodesIn.slice(0, LIMITS.nodes)) {
    const o = (typeof n === "string" ? { label: n } : n && typeof n === "object" ? n : null) as Record<string, unknown> | null;
    if (!o) continue;
    const label = clip(first(o.label, o.title, o.name, o.text, o.id), LIMITS.label);
    if (!label) continue;
    const alias = String(first(o.id, label));
    let id = slug(alias);
    while (nodes.some((x) => x.id === id)) id += "_";
    nodeKey.set(alias.toLowerCase(), id);
    nodeKey.set(label.toLowerCase(), id);
    nodeKey.set(id, id);
    const tech = Array.isArray(o.technologies) ? o.technologies.filter((t) => typeof t === "string").join(" · ") : typeof o.technology === "string" ? o.technology : "";
    const subtitle = clip(first(o.subtitle, o.description, o.detail, tech), LIMITS.subtitle);
    const groupRef = first(o.group, o.groupId, o.parent, o.cluster);
    const gid = typeof groupRef === "string" ? groupIds.get(groupRef.toLowerCase()) : undefined;
    nodes.push({
      id,
      label,
      subtitle: subtitle || undefined,
      icon: resolveIconName(first(o.icon, o.lucideIcon), `${label} ${tech}`),
      shape: shapeOf(first(o.shape, o.type, o.nodeType)),
      color: typeof first(o.color, o.category) === "string" ? String(first(o.color, o.category)) : undefined,
      group: gid,
      fields: normalizeFields(first(o.fields, o.columns, o.attributes)),
    });
  }

  // ---- edges
  const edgesIn = Array.isArray(src.edges) ? src.edges : Array.isArray(src.connections) ? src.connections : Array.isArray(src.relations) ? src.relations : Array.isArray(src.links) ? src.links : [];
  const ensure = (ref: unknown): string | undefined => {
    if (typeof ref !== "string" && typeof ref !== "number") return undefined;
    const key = String(ref).toLowerCase().trim();
    if (!key) return undefined;
    const known = nodeKey.get(key) ?? nodeKey.get(slug(key));
    if (known) return known;
    if (nodes.length >= LIMITS.nodes) return undefined;
    // An edge mentions a component the model forgot to declare: create it instead of dropping the edge.
    const label = String(ref).trim().slice(0, LIMITS.label);
    let id = slug(label);
    while (nodes.some((x) => x.id === id)) id += "_";
    nodes.push({ id, label, icon: resolveIconName(undefined, label) });
    nodeKey.set(key, id);
    nodeKey.set(id, id);
    warnings.push(`Added missing component "${label}".`);
    return id;
  };
  const edges: GEdge[] = [];
  const seenEdges = new Set<string>();
  for (const e of edgesIn.slice(0, LIMITS.edges)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const from = ensure(first(o.from, o.source, o.src, o.start));
    const to = ensure(first(o.to, o.target, o.dst, o.end));
    if (!from || !to || (from === to && kind !== "sequence")) continue;
    const label = clip(first(o.label, o.text, o.protocol, o.name), 60) || undefined;
    const key = `${from}>${to}>${label ?? ""}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const style = typeof o.style === "string" && ["solid", "dashed", "dotted"].includes(o.style) ? (o.style as EdgeStyle) : o.async === true || o.dashed === true ? "dashed" : undefined;
    const dir = String(first(o.arrow, o.direction, o.type) ?? "").toLowerCase();
    const arrow: EdgeArrow | undefined = /both|bi|two|<>/.test(dir) ? "both" : /none|undirected|line/.test(dir) ? "none" : /back|reverse/.test(dir) ? "back" : undefined;
    edges.push({ from, to, label, style, arrow });
  }

  // ---- sequence messages
  let messages: GMessage[] | undefined;
  if (kind === "sequence") {
    const msgIn = Array.isArray(src.messages) ? src.messages : Array.isArray(src.steps) ? src.steps : edgesIn;
    messages = [];
    for (const m of msgIn.slice(0, LIMITS.messages)) {
      if (!m || typeof m !== "object") continue;
      const o = m as Record<string, unknown>;
      const from = ensure(first(o.from, o.source));
      const to = ensure(first(o.to, o.target));
      const label = clip(first(o.label, o.text, o.message, o.name), 70);
      if (!from || !to || !label) continue;
      const k = String(first(o.kind, o.type) ?? "").toLowerCase();
      messages.push({ from, to, label, kind: /return|response|reply/.test(k) ? "return" : /async|event/.test(k) ? "async" : "sync" });
    }
    if (messages.length === 0) warnings.push("The sequence diagram had no messages.");
  }

  // drop empty groups and clear dangling group references
  const used = new Set<string>();
  for (const n of nodes) if (n.group) used.add(n.group);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) if (g.parent && used.has(g.id) && !used.has(g.parent)) {
      used.add(g.parent);
      changed = true;
    }
  }
  const keptGroups = groups.filter((g) => used.has(g.id));
  if (keptGroups.length !== groups.length) warnings.push("Removed empty groups.");

  const title = clip(first(src.title, src.name), 80) || undefined;
  const dirRaw = String(first(src.direction, src.layout) ?? "").toLowerCase();
  const direction: Graph["direction"] = /right|lr|horizontal/.test(dirRaw) ? "right" : /down|tb|vertical|top/.test(dirRaw) ? "down" : "auto";

  return { graph: { kind, title, direction, nodes, groups: keptGroups, edges, messages }, warnings };
}

/** Accent colour to use for a node (explicit colour > icon colour > undefined). */
export function nodeAccent(n: GNode): string | undefined {
  if (n.color) return accentFromName(n.color);
  return undefined;
}

export function descendantsOf(groups: GGroup[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) if (g.parent && out.has(g.parent) && !out.has(g.id)) {
      out.add(g.id);
      grew = true;
    }
  }
  return out;
}
