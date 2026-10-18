import type { TableColumn } from "../canvas/types";
import { DIAGRAM_KINDS, FLOW_SHAPES, LIMITS, resolveIconName, slug, type DiagramKind, type EdgeArrow, type EdgeStyle, type GEdge, type GGroup, type GMessage, type GNode, type Graph } from "./graph";

/**
 * Diagram-as-code, modelled on Eraser's syntax:
 *
 *   title Checkout
 *   type architecture            (architecture | flowchart | erd | mindmap | sequence)
 *   direction right              (down | right | auto)
 *
 *   Edge [color: blue] {
 *     CDN [icon: cloudflare]
 *     API gateway [subtitle: "Rate limiting"]
 *   }
 *   Web app [icon: nextdotjs] > CDN > API gateway: HTTPS
 *   API gateway <> Redis
 *   Orders --> Kafka: events
 *
 * Operators (surrounded by spaces):  >  <  <>  -  --  -->   (arrow, back-arrow, both, line, dashed line, dashed arrow)
 */

export interface DslError {
  line: number;
  message: string;
}

export interface ParseResult {
  graph: Graph;
  errors: DslError[];
}

const OP = /\s+(<->|<>|-->|->|--|>|<|-)\s+/;

function stripComment(line: string): string {
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    if (!inQ && c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQ = false;
  let cur = "";
  for (const c of s) {
    if (c === '"') inQ = !inQ;
    if (!inQ) {
      if (c === "[") depth++;
      if (c === "]") depth--;
      if (c === sep && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

interface Props {
  [key: string]: string;
}

function parseProps(body: string): Props {
  const props: Props = {};
  for (const part of splitTop(body, ",")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    let val = part.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
    if (key) props[key] = val;
  }
  return props;
}

/** "Name [a: b]" -> { name, props } */
function splitNameProps(text: string): { name: string; props: Props } {
  const m = text.match(/^(.*?)\s*\[(.*)\]\s*$/);
  if (!m) return { name: text.trim(), props: {} };
  return { name: m[1].trim(), props: parseProps(m[2]) };
}

function unquote(s: string): string {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1) : t;
}

function operatorToEdge(op: string): { arrow: EdgeArrow; style: EdgeStyle } {
  switch (op) {
    case ">":
    case "->":
      return { arrow: "forward", style: "solid" };
    case "-->":
      return { arrow: "forward", style: "dashed" };
    case "<":
      return { arrow: "back", style: "solid" };
    case "<>":
    case "<->":
      return { arrow: "both", style: "solid" };
    case "--":
      return { arrow: "none", style: "dashed" };
    default:
      return { arrow: "none", style: "solid" };
  }
}

export function parseDsl(source: string): ParseResult {
  const errors: DslError[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let kind: DiagramKind = "architecture";
  let title: string | undefined;
  let direction: Graph["direction"] = "auto";

  // First pass: find `type` so block semantics (group vs. entity) are known up front.
  for (const raw of lines) {
    const m = stripComment(raw).trim().match(/^(?:type|diagram)\s+(\w+)\s*$/i);
    if (m && (DIAGRAM_KINDS as string[]).includes(m[1].toLowerCase())) kind = m[1].toLowerCase() as DiagramKind;
  }

  const nodes: GNode[] = [];
  const groups: GGroup[] = [];
  const edges: GEdge[] = [];
  const messages: GMessage[] = [];
  const byName = new Map<string, GNode>();
  const groupStack: GGroup[] = [];
  let entity: GNode | null = null;

  const getNode = (rawName: string, props: Props, line: number): GNode | null => {
    const name = unquote(rawName);
    if (!name) return null;
    const key = name.toLowerCase();
    let n = byName.get(key);
    if (!n) {
      if (nodes.length >= LIMITS.nodes) {
        errors.push({ line, message: `Too many components (max ${LIMITS.nodes}).` });
        return null;
      }
      let id = slug(name);
      while (nodes.some((x) => x.id === id)) id += "_";
      n = { id, label: name, group: groupStack[groupStack.length - 1]?.id };
      nodes.push(n);
      byName.set(key, n);
    }
    if (props.label) n.label = props.label;
    if (props.subtitle || props.description) n.subtitle = props.subtitle || props.description;
    if (props.icon) n.icon = resolveIconName(props.icon, undefined) ?? n.icon;
    if (props.color) n.color = props.color;
    if (props.shape) {
      const s = props.shape.toLowerCase();
      if ((FLOW_SHAPES as string[]).includes(s)) n.shape = s as GNode["shape"];
    }
    if (!n.icon && kind === "architecture") n.icon = resolveIconName(undefined, n.label);
    return n;
  };

  // Expand one-line blocks ("orgs { id uuid pk, name text }") so the main loop only sees one construct per line.
  const entries: { text: string; no: number }[] = [];
  lines.forEach((raw, i) => {
    const text = stripComment(raw).trim();
    const inline = text.match(/^([^{}]+?)s*{(.*)}s*$/);
    if (inline && !text.startsWith("#")) {
      entries.push({ text: `${inline[1].trim()} {`, no: i + 1 });
      for (const part of splitTop(inline[2].replace(/;/g, ","), ",")) if (part.trim()) entries.push({ text: part.trim(), no: i + 1 });
      entries.push({ text: "}", no: i + 1 });
    } else entries.push({ text, no: i + 1 });
  });

  entries.forEach(({ text, no: lineNo }) => {
    let line = text;
    if (!line || line.startsWith("#")) return;

    const dir = line.match(/^(title|direction|type|diagram)\s+(.+)$/i);
    if (dir) {
      const key = dir[1].toLowerCase();
      const value = dir[2].trim();
      if (key === "title") title = unquote(value).slice(0, 80);
      else if (key === "direction") direction = /right|lr|horizontal/i.test(value) ? "right" : /down|tb|vertical|top/i.test(value) ? "down" : "auto";
      return; // `type` already handled
    }

    if (line === "}") {
      if (entity) entity = null;
      else if (groupStack.length) groupStack.pop();
      else errors.push({ line: lineNo, message: "Unexpected }" });
      return;
    }

    // Entity fields:  name type [pk|fk|unique]
    if (entity) {
      const parts = line.replace(/[,;]$/, "").split(/\s+/);
      const name = parts[0];
      if (name) {
        const col: TableColumn = { name: name.slice(0, 40) };
        if (parts[1] && !/^(pk|fk|unique|uq|primary|foreign)$/i.test(parts[1])) col.type = parts[1].slice(0, 24);
        const keyWord = parts.slice(1).find((p) => /^(pk|fk|unique|uq|primary|foreign)$/i.test(p));
        if (keyWord) col.key = /^(pk|primary)$/i.test(keyWord) ? "pk" : /^(fk|foreign)$/i.test(keyWord) ? "fk" : "unique";
        (entity.fields ??= []).push(col);
      }
      return;
    }

    // Block open:  Name [props] {
    if (line.endsWith("{")) {
      const head = line.slice(0, -1).trim();
      const { name, props } = splitNameProps(head);
      if (!name) {
        errors.push({ line: lineNo, message: "A block needs a name before {" });
        return;
      }
      if (kind === "erd") {
        const n = getNode(name, props, lineNo);
        if (n) {
          n.fields = n.fields ?? [];
          entity = n;
        }
      } else {
        if (groups.length >= LIMITS.groups) {
          errors.push({ line: lineNo, message: `Too many groups (max ${LIMITS.groups}).` });
          return;
        }
        let id = slug(unquote(name));
        while (groups.some((g) => g.id === id)) id += "_";
        const g: GGroup = { id, label: props.label || unquote(name), parent: groupStack[groupStack.length - 1]?.id, color: props.color, icon: props.icon ? resolveIconName(props.icon) : undefined };
        groups.push(g);
        groupStack.push(g);
      }
      return;
    }

    // Connections  (labels follow the last operand after ':' )
    const hasOp = OP.test(line.replace(/\[[^\]]*\]/g, (m) => m.replace(/\s/g, "_")));
    if (hasOp) {
      let label: string | undefined;
      // `: label` that comes after the final operand (props use ':' too, but only inside [ ])
      let depth = 0;
      let inQ = false;
      let colon = -1;
      for (let k = 0; k < line.length; k++) {
        const c = line[k];
        if (c === '"') inQ = !inQ;
        if (inQ) continue;
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ":" && depth === 0) {
          colon = k;
          break;
        }
      }
      if (colon >= 0) {
        label = unquote(line.slice(colon + 1)).slice(0, 70);
        line = line.slice(0, colon).trim();
      }
      // protect whitespace inside [...] so operator splitting only sees real operators
      const protectedLine = line.replace(/\[[^\]]*\]/g, (m) => m.replace(/ /g, "\u0001"));
      const tokens = protectedLine.split(OP).map((t) => t.replace(/\u0001/g, " "));
      // tokens: operand, op, operand, op, operand ...
      const operands: { names: { name: string; props: Props }[] }[] = [];
      const ops: string[] = [];
      tokens.forEach((t, idx) => {
        if (idx % 2 === 0) operands.push({ names: splitTop(t, ",").map((s) => splitNameProps(s.trim())).filter((x) => x.name) });
        else ops.push(t);
      });
      for (let k = 0; k < ops.length; k++) {
        const left = operands[k]?.names ?? [];
        const right = operands[k + 1]?.names ?? [];
        const { arrow, style } = operatorToEdge(ops[k]);
        for (const l of left) {
          for (const r of right) {
            const a = getNode(l.name, l.props, lineNo);
            const b = getNode(r.name, r.props, lineNo);
            if (!a || !b) continue;
            if (kind === "sequence") {
              if (messages.length < LIMITS.messages) {
                const back = arrow === "back";
                messages.push({
                  from: back ? b.id : a.id,
                  to: back ? a.id : b.id,
                  label: label || "message",
                  kind: style === "dashed" ? "return" : "sync",
                });
              }
              continue;
            }
            if (edges.length >= LIMITS.edges) {
              errors.push({ line: lineNo, message: `Too many connections (max ${LIMITS.edges}).` });
              continue;
            }
            edges.push({ from: a.id, to: b.id, label, arrow, style: style === "solid" ? undefined : style });
          }
        }
      }
      return;
    }

    // Plain declaration:  Name [props]
    const { name, props } = splitNameProps(line);
    if (!name) return;
    if (/[<>{}]/.test(name)) {
      errors.push({ line: lineNo, message: `Could not understand “${line.slice(0, 40)}”.` });
      return;
    }
    getNode(name, props, lineNo);
  });

  if (entity || groupStack.length) errors.push({ line: lines.length, message: "A { block is missing its closing }." });

  const graph: Graph = {
    kind,
    title,
    direction,
    nodes,
    groups,
    edges,
    ...(kind === "sequence" ? { messages } : {}),
  };
  return { graph, errors };
}

/* ----------------------------------------------------------------- serialiser */

function quoteIf(s: string): string {
  return /[,\]\[:"]/.test(s) ? `"${s.replace(/"/g, "'")}"` : s;
}

function shortIcon(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const short = key.slice(key.indexOf(":") + 1);
  const trial = resolveIconName(short);
  return trial === key ? short : key;
}

export function graphToDsl(g: Graph): string {
  const out: string[] = [];
  if (g.title) out.push(`title ${g.title}`);
  out.push(`type ${g.kind}`);
  if (g.direction && g.direction !== "auto") out.push(`direction ${g.direction}`);
  out.push("");

  // unique display names
  const nameOf = new Map<string, string>();
  const used = new Set<string>();
  for (const n of g.nodes) {
    const name = n.label.replace(/[<>{}\[\]:,]/g, " ").replace(/\s+/g, " ").trim() || n.id;
    let candidate = name;
    let i = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${name} ${i++}`;
    used.add(candidate.toLowerCase());
    nameOf.set(n.id, candidate);
  }

  const propsOf = (n: GNode): string => {
    const p: string[] = [];
    const icon = shortIcon(n.icon);
    if (icon && !(g.kind === "architecture" && n.icon === resolveIconName(undefined, n.label))) p.push(`icon: ${icon}`);
    if (n.subtitle) p.push(`subtitle: ${quoteIf(n.subtitle)}`);
    if (n.color) p.push(`color: ${n.color}`);
    if (n.shape && g.kind === "flowchart") p.push(`shape: ${n.shape}`);
    return p.length ? ` [${p.join(", ")}]` : "";
  };

  if (g.kind === "erd") {
    for (const n of g.nodes) {
      out.push(`${nameOf.get(n.id)} {`);
      for (const f of n.fields ?? []) out.push(`  ${f.name}${f.type ? ` ${f.type}` : ""}${f.key ? ` ${f.key}` : ""}`);
      out.push("}");
      out.push("");
    }
  } else if (g.kind === "sequence") {
    for (const n of g.nodes) out.push(`${nameOf.get(n.id)}${propsOf(n)}`);
    out.push("");
    for (const m of g.messages ?? []) {
      const op = m.kind === "return" ? "-->" : ">";
      out.push(`${nameOf.get(m.from)} ${op} ${nameOf.get(m.to)}: ${m.label}`);
    }
  } else {
    const emitGroup = (grp: GGroup, depth: number) => {
      const pad = "  ".repeat(depth);
      const props: string[] = [];
      if (grp.color) props.push(`color: ${grp.color}`);
      const gi = shortIcon(grp.icon);
      if (gi) props.push(`icon: ${gi}`);
      out.push(`${pad}${grp.label}${props.length ? ` [${props.join(", ")}]` : ""} {`);
      for (const child of g.groups.filter((c) => c.parent === grp.id)) emitGroup(child, depth + 1);
      for (const n of g.nodes.filter((x) => x.group === grp.id)) out.push(`${pad}  ${nameOf.get(n.id)}${propsOf(n)}`);
      out.push(`${pad}}`);
    };
    const groupIds = new Set(g.groups.map((x) => x.id));
    for (const grp of g.groups.filter((x) => !x.parent || !groupIds.has(x.parent))) emitGroup(grp, 0);
    for (const n of g.nodes.filter((x) => !x.group)) out.push(`${nameOf.get(n.id)}${propsOf(n)}`);
    out.push("");
    for (const e of g.edges) {
      const op = e.arrow === "none" ? (e.style === "dashed" ? "--" : "-") : e.arrow === "both" ? "<>" : e.arrow === "back" ? "<" : e.style === "dashed" ? "-->" : ">";
      out.push(`${nameOf.get(e.from)} ${op} ${nameOf.get(e.to)}${e.label ? `: ${e.label}` : ""}`);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export const DSL_EXAMPLE = `title Order platform
type architecture
direction right

Edge [color: blue] {
  CDN [icon: cloudflare]
  API gateway [subtitle: "Auth · rate limiting"]
}

Data [color: green] {
  PostgreSQL [subtitle: "Orders"]
  Redis [subtitle: "Sessions"]
}

Web app [icon: nextdotjs] > CDN: HTTPS
CDN > API gateway
API gateway > Orders service: gRPC
Orders service > PostgreSQL: SQL
Orders service > Redis
Orders service --> Kafka: OrderPlaced
Kafka > Fulfilment worker
`;

