/**
 * Incremental reader for the diagram JSON a model streams token by token. It never waits for the
 * whole reply: every group / node / edge / message object is handed out the moment its closing brace
 * arrives, so the canvas can draw the diagram while the model is still writing it.
 *
 * It is deliberately forgiving and only ever *additive*: anything it cannot read is skipped, and the
 * complete reply is still parsed and validated at the end (`extractJson` + `normalizeGraph`), which
 * stays the source of truth.
 */

export type StreamSection = "groups" | "nodes" | "edges" | "messages";

export type StreamItem =
  | { kind: "meta"; key: "kind" | "title" | "direction"; value: string }
  | { kind: "item"; section: StreamSection; value: Record<string, unknown> };

const SECTION_OF: Record<string, StreamSection> = {
  groups: "groups",
  clusters: "groups",
  nodes: "nodes",
  entities: "nodes",
  participants: "nodes",
  edges: "edges",
  connections: "edges",
  relations: "edges",
  links: "edges",
  messages: "messages",
  steps: "messages",
};

const META_KEYS = new Set(["kind", "title", "direction"]);

function parseObject(src: string): Record<string, unknown> | null {
  for (const candidate of [src, src.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const v: unknown = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the cleaned-up copy, then give up on this object */
    }
  }
  return null;
}

export class GraphStreamParser {
  private buf = "";
  private pos = 0;
  private started = false;
  private done = false;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private strStart = -1;
  /** Top-level key whose value is being read. */
  private key: string | null = null;
  private expectKey = true;
  private section: StreamSection | null = null;
  private itemStart = -1;

  /** Feeds the next piece of the reply; returns whatever became complete because of it. */
  push(chunk: string): StreamItem[] {
    if (this.done || !chunk) return [];
    this.buf += chunk;
    if (!this.started && !this.begin()) return [];
    return this.scan();
  }

  /** Waits out a `<think>` block, then locks on to the first `{` of the answer. */
  private begin(): boolean {
    const lower = this.buf.toLowerCase();
    const closeAt = lower.lastIndexOf("</think>");
    if (lower.lastIndexOf("<think>") > closeAt) return false;
    const brace = this.buf.indexOf("{", closeAt >= 0 ? closeAt + 8 : 0);
    if (brace < 0) return false;
    this.started = true;
    this.pos = brace;
    return true;
  }

  private scan(): StreamItem[] {
    const out: StreamItem[] = [];
    const b = this.buf;
    for (; this.pos < b.length; this.pos++) {
      const c = b[this.pos];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === "\\") this.esc = true;
        else if (c === '"') {
          this.inStr = false;
          this.onString(out);
        }
        continue;
      }
      switch (c) {
        case '"':
          this.inStr = true;
          this.strStart = this.pos;
          break;
        case "{":
          this.depth++;
          if (this.depth === 3 && this.section) this.itemStart = this.pos;
          break;
        case "[":
          this.depth++;
          if (this.depth === 2) this.section = this.key ? (SECTION_OF[this.key.toLowerCase()] ?? null) : null;
          break;
        case "}":
          if (this.depth === 3 && this.section && this.itemStart >= 0) {
            const value = parseObject(b.slice(this.itemStart, this.pos + 1));
            if (value) out.push({ kind: "item", section: this.section, value });
            this.itemStart = -1;
          }
          this.depth--;
          if (this.depth <= 0) {
            this.done = true;
            this.pos = b.length;
            return out;
          }
          break;
        case "]":
          this.depth--;
          if (this.depth === 1) this.section = null;
          break;
        case ":":
          if (this.depth === 1) this.expectKey = false;
          break;
        case ",":
          if (this.depth === 1) {
            this.expectKey = true;
            this.key = null;
          }
          break;
      }
    }
    return out;
  }

  private onString(out: StreamItem[]) {
    const raw = this.buf.slice(this.strStart, this.pos + 1);
    if (this.depth === 1) {
      const text = decode(raw);
      if (text === null) return;
      if (this.expectKey) this.key = text;
      else if (this.key && META_KEYS.has(this.key)) out.push({ kind: "meta", key: this.key as "kind" | "title" | "direction", value: text });
    } else if (this.depth === 2 && this.section === "nodes") {
      // `"nodes": ["API", "Cache"]` is accepted by normalizeGraph, so it streams too.
      const text = decode(raw);
      if (text) out.push({ kind: "item", section: "nodes", value: { label: text } });
    }
  }
}

function decode(quoted: string): string | null {
  try {
    const v: unknown = JSON.parse(quoted);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}
