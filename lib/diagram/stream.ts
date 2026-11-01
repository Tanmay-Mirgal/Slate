import type { StreamItem, StreamSection } from "../ai/stream-parse";
import { normalizeGraph, slug, type DiagramKind, type Graph } from "./graph";

type Raw = Record<string, unknown>;

const first = (...vals: unknown[]): unknown => vals.find((v) => v !== undefined && v !== null && v !== "");
const keysOf = (ref: unknown): string[] => {
  if (typeof ref !== "string" && typeof ref !== "number") return [];
  const k = String(ref).toLowerCase().trim();
  return k ? [k, slug(k)] : [];
};

/**
 * Builds a drawable Graph out of the pieces a model has streamed so far. It runs the same
 * `normalizeGraph` as the finished reply, so what appears while streaming is what the final
 * diagram will contain; the only extra rule is that a connection is held back until both of its
 * ends have been declared (otherwise normalizeGraph would invent placeholder components for them).
 */
export class StreamingGraph {
  private meta: { kind?: string; title?: string; direction?: string } = {};
  private lists: Record<StreamSection, Raw[]> = { groups: [], nodes: [], edges: [], messages: [] };
  private pending: { section: "edges" | "messages"; value: Raw }[] = [];
  private known = new Set<string>();

  constructor(private fallbackKind: DiagramKind = "architecture") {}

  get empty(): boolean {
    return this.lists.nodes.length === 0;
  }

  /** Takes the next streamed piece; true when the drawable graph changed. */
  push(item: StreamItem): boolean {
    if (item.kind === "meta") {
      this.meta[item.key] = item.value;
      return item.key === "kind";
    }
    const { section, value } = item;
    if (section === "edges" || section === "messages") {
      if (this.resolvable(value)) this.lists[section].push(value);
      else this.pending.push({ section, value });
      return true;
    }
    this.lists[section].push(value);
    if (section === "nodes") {
      const alias = first(value.id, value.label, value.title, value.name, value.text);
      for (const k of [...keysOf(alias), ...keysOf(first(value.label, value.title, value.name, value.text))]) this.known.add(k);
      this.releasePending();
    }
    return true;
  }

  private ends(v: Raw): unknown[] {
    return [first(v.from, v.source, v.src, v.start), first(v.to, v.target, v.dst, v.end)];
  }

  private resolvable(v: Raw): boolean {
    return this.ends(v).every((ref) => keysOf(ref).some((k) => this.known.has(k)));
  }

  private releasePending() {
    if (!this.pending.length) return;
    const still: typeof this.pending = [];
    for (const p of this.pending) {
      if (this.resolvable(p.value)) this.lists[p.section].push(p.value);
      else still.push(p);
    }
    this.pending = still;
  }

  /** The graph so far, or null until the first component exists. */
  snapshot(): Graph | null {
    if (this.empty) return null;
    const { graph } = normalizeGraph({ ...this.meta, ...this.lists }, this.fallbackKind);
    return graph;
  }
}
