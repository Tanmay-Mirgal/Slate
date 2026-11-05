import type { Graph } from "@/lib/diagram/graph";

/**
 * A Mermaid rendering of a diagram, for the Markdown export (GitHub, Notion and most wikis draw it inline).
 * Best effort: Mermaid has less vocabulary than Slate (no icons, fewer shapes), so the exact diagram-as-code
 * block is exported next to it.
 */

const safeId = (prefix: string, id: string) => `${prefix}_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
const text = (s: string) => s.replace(/"/g, "#quot;").replace(/[\r\n]+/g, " ").trim();

function flow(g: Graph): string {
  const lines = [`flowchart ${g.direction === "down" ? "TD" : "LR"}`];
  const known = new Set(g.groups.map((x) => x.id));
  const node = (n: Graph["nodes"][number]) => {
    const label = n.subtitle ? `${text(n.label)}<br/>${text(n.subtitle)}` : text(n.label);
    const id = safeId("n", n.id);
    if (n.shape === "decision") return `${id}{"${label}"}`;
    if (n.shape === "terminator") return `${id}(["${label}"])`;
    if (n.shape === "data") return `${id}[("${label}")]`;
    return `${id}["${label}"]`;
  };
  const emitGroup = (gid: string | undefined, depth: number) => {
    const pad = "  ".repeat(depth);
    for (const n of g.nodes.filter((x) => (gid ? x.group === gid : !x.group || !known.has(x.group)))) lines.push(`${pad}${node(n)}`);
    for (const sub of g.groups.filter((x) => (gid ? x.parent === gid : !x.parent || !known.has(x.parent)))) {
      lines.push(`${pad}subgraph ${safeId("g", sub.id)}["${text(sub.label)}"]`);
      emitGroup(sub.id, depth + 1);
      lines.push(`${pad}end`);
    }
  };
  emitGroup(undefined, 1);
  for (const e of g.edges) {
    const label = e.label ? `|${text(e.label)}|` : "";
    const dashed = e.style === "dashed" || e.style === "dotted";
    const link = e.arrow === "none" ? (dashed ? "-.-" : "---") : e.arrow === "both" ? (dashed ? "<-.->" : "<-->") : dashed ? "-.->" : "-->";
    const [from, to] = e.arrow === "back" ? [e.to, e.from] : [e.from, e.to];
    lines.push(`  ${safeId("n", from)} ${link}${label} ${safeId("n", to)}`);
  }
  return lines.join("\n");
}

function erd(g: Graph): string {
  const lines = ["erDiagram"];
  const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_") || "x";
  for (const n of g.nodes) {
    lines.push(`  ${safeId("E", n.id)} {`);
    for (const f of n.fields ?? []) lines.push(`    ${ident(f.type || "string")} ${ident(f.name)}${f.key === "pk" ? " PK" : f.key === "fk" ? " FK" : f.key === "unique" ? " UK" : ""}`);
    lines.push("  }");
  }
  for (const e of g.edges) lines.push(`  ${safeId("E", e.from)} }o--|| ${safeId("E", e.to)} : "${text(e.label || "relates")}"`);
  return lines.join("\n");
}

function sequence(g: Graph): string {
  const lines = ["sequenceDiagram"];
  for (const n of g.nodes) lines.push(`  participant ${safeId("P", n.id)} as ${text(n.label)}`);
  for (const m of g.messages ?? []) lines.push(`  ${safeId("P", m.from)}${m.kind === "return" ? "-->>" : m.kind === "async" ? "-)" : "->>"}${safeId("P", m.to)}: ${text(m.label)}`);
  return lines.join("\n");
}

function mindmap(g: Graph): string {
  const incoming = new Set(g.edges.map((e) => e.to));
  const root = g.nodes.find((n) => !incoming.has(n.id)) ?? g.nodes[0];
  const lines = ["mindmap", `  root(("${text(root?.label ?? g.title ?? "Mind map")}"))`];
  const seen = new Set<string>(root ? [root.id] : []);
  const walk = (id: string, depth: number) => {
    for (const e of g.edges.filter((x) => x.from === id)) {
      const n = g.nodes.find((x) => x.id === e.to);
      if (!n || seen.has(n.id)) continue;
      seen.add(n.id);
      lines.push(`${"  ".repeat(depth + 1)}${text(n.label).replace(/[()[\]{}]/g, "")}`);
      walk(n.id, depth + 1);
    }
  };
  if (root) walk(root.id, 1);
  return lines.join("\n");
}

export function graphToMermaid(g: Graph): string {
  if (g.nodes.length === 0) return "";
  if (g.kind === "erd") return erd(g);
  if (g.kind === "sequence") return sequence(g);
  if (g.kind === "mindmap") return mindmap(g);
  return flow(g);
}
