import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateGraph } from "@/lib/ai/generate";
import type { NvidiaConfig } from "@/lib/ai/nvidia";
import { GraphStreamParser, type StreamItem } from "@/lib/ai/stream-parse";
import { normalizeGraph } from "@/lib/diagram/graph";
import { StreamingGraph } from "@/lib/diagram/stream";

const REPLY = {
  kind: "architecture",
  title: "Shop",
  direction: "right",
  groups: [{ id: "backend", label: "Backend", color: "blue" }],
  nodes: [
    { id: "web", label: "Web {client}", icon: "react" },
    { id: "api", label: 'API "v2"', subtitle: "Node.js", group: "backend" },
    { id: "db", label: "PostgreSQL", group: "backend", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "owner", key: "fk" }] },
  ],
  edges: [
    { from: "web", to: "api", label: "HTTPS" },
    { from: "api", to: "db", label: "SQL" },
  ],
};
const TEXT = JSON.stringify(REPLY, null, 2);

function feed(text: string, size: number, parser = new GraphStreamParser()): StreamItem[] {
  const out: StreamItem[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...parser.push(text.slice(i, i + size)));
  return out;
}

describe("GraphStreamParser", () => {
  it("emits every group, node and edge exactly once, whatever the chunking", () => {
    const whole = feed(TEXT, TEXT.length);
    expect(whole.filter((i) => i.kind === "item").map((i) => (i.kind === "item" ? i.section : ""))).toEqual(["groups", "nodes", "nodes", "nodes", "edges", "edges"]);
    for (const size of [1, 2, 3, 7, 19, 64]) expect(feed(TEXT, size)).toEqual(whole);
  });

  it("reads the scalar header fields", () => {
    const meta = feed(TEXT, 5).filter((i) => i.kind === "meta");
    expect(meta).toEqual([
      { kind: "meta", key: "kind", value: "architecture" },
      { kind: "meta", key: "title", value: "Shop" },
      { kind: "meta", key: "direction", value: "right" },
    ]);
  });

  it("keeps braces, quotes and nested arrays inside one item", () => {
    const items = feed(TEXT, 4).filter((i) => i.kind === "item" && i.section === "nodes");
    expect(items.map((i) => (i.kind === "item" ? i.value.label : null))).toEqual(["Web {client}", 'API "v2"', "PostgreSQL"]);
    const db = items[2];
    expect(db.kind === "item" && db.value.fields).toEqual([{ name: "id", type: "uuid", key: "pk" }, { name: "owner", key: "fk" }]);
  });

  it("only hands out an item once its closing brace has arrived", () => {
    const p = new GraphStreamParser();
    expect(p.push('{"nodes":[{"id":"a","label":"A"},{"id":"b","la')).toHaveLength(1);
    expect(p.push('bel":"B"}')).toHaveLength(1);
    expect(p.push("]}")).toHaveLength(0);
  });

  it("skips reasoning blocks and code fences before the object", () => {
    const text = '<think>maybe {"nodes":[{"id":"fake"}]} hmm</think>\n```json\n' + TEXT + "\n```";
    expect(feed(text, 6)).toEqual(feed(TEXT, 6));
    const p = new GraphStreamParser();
    expect(p.push('<think>{"nodes":[{"id":"x","label":"X"}]}')).toEqual([]);
  });

  it("accepts the aliases normalizeGraph accepts", () => {
    const items = feed('{"entities":[{"name":"User"}],"relations":[{"source":"User","target":"User"}]}', 9);
    expect(items.map((i) => (i.kind === "item" ? i.section : i.kind))).toEqual(["nodes", "edges"]);
  });

  it("streams a plain list of names and survives trailing commas", () => {
    const items = feed('{"nodes":["API","Cache"],"edges":[{"from":"API","to":"Cache",},]}', 5);
    expect(items.map((i) => (i.kind === "item" ? i.section : i.kind))).toEqual(["nodes", "nodes", "edges"]);
  });

  it("ignores anything after the object closes", () => {
    const p = new GraphStreamParser();
    p.push('{"nodes":[]}');
    expect(p.push('{"nodes":[{"id":"late","label":"Late"}]}')).toEqual([]);
  });
});

describe("StreamingGraph", () => {
  const build = (items: StreamItem[]) => {
    const g = new StreamingGraph();
    for (const i of items) g.push(i);
    return g;
  };

  it("converges on exactly what the finished reply normalises to", () => {
    const g = build(feed(TEXT, 11));
    expect(g.snapshot()).toEqual(normalizeGraph(REPLY).graph);
  });

  it("is empty until the first component arrives", () => {
    const g = new StreamingGraph();
    expect(g.snapshot()).toBeNull();
    g.push({ kind: "meta", key: "title", value: "Shop" });
    expect(g.snapshot()).toBeNull();
    g.push({ kind: "item", section: "nodes", value: { id: "a", label: "A" } });
    expect(g.snapshot()?.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("holds a connection back until both of its ends exist", () => {
    const g = new StreamingGraph();
    g.push({ kind: "item", section: "nodes", value: { id: "web", label: "Web" } });
    g.push({ kind: "item", section: "edges", value: { from: "web", to: "api" } });
    expect(g.snapshot()?.nodes).toHaveLength(1); // no phantom "api" component
    expect(g.snapshot()?.edges).toHaveLength(0);
    g.push({ kind: "item", section: "nodes", value: { id: "api", label: "API Gateway" } });
    expect(g.snapshot()?.nodes).toHaveLength(2);
    expect(g.snapshot()?.edges).toEqual([{ from: "web", to: "api", label: undefined, style: undefined, arrow: undefined }]);
  });

  it("matches ends by id, label or slug", () => {
    const g = new StreamingGraph();
    g.push({ kind: "item", section: "nodes", value: { id: "n1", label: "Order Service" } });
    g.push({ kind: "item", section: "nodes", value: { id: "n2", label: "Redis" } });
    g.push({ kind: "item", section: "edges", value: { from: "Order Service", to: "redis" } });
    g.push({ kind: "item", section: "edges", value: { source: "n1", target: "n2", label: "cache" } });
    expect(g.snapshot()?.edges).toHaveLength(2);
  });

  it("builds sequence diagrams as messages arrive", () => {
    const g = new StreamingGraph();
    g.push({ kind: "meta", key: "kind", value: "sequence" });
    g.push({ kind: "item", section: "nodes", value: { id: "a", label: "Browser" } });
    g.push({ kind: "item", section: "nodes", value: { id: "b", label: "API" } });
    g.push({ kind: "item", section: "messages", value: { from: "a", to: "b", label: "GET /me" } });
    const snap = g.snapshot();
    expect(snap?.kind).toBe("sequence");
    expect(snap?.messages).toEqual([{ from: "a", to: "b", label: "GET /me", kind: "sync" }]);
  });
});

describe("generateGraph streaming", () => {
  const cfg: NvidiaConfig = { apiKey: "nvapi-test-key", baseUrl: "https://nim.test/v1", models: ["model-a", "model-b"] };
  const input = { prompt: "Make me a diagram", kind: "auto" as const, complexity: "standard" as const };
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function sse(content: string, size = 25): Response {
    const enc = new TextEncoder();
    const events: string[] = [];
    for (let i = 0; i < content.length; i += size) events.push(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + size) } }] })}\n\n`);
    events.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n");
    const stream = new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(e));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("reports components while the reply is still arriving, before the result", async () => {
    fetchMock.mockResolvedValueOnce(sse(TEXT));
    const order: string[] = [];
    const r = await generateGraph(input, cfg, {
      onStatus: () => order.push("status"),
      onItem: (i) => order.push(i.kind === "item" ? i.section : i.kind),
    });
    expect(order[0]).toBe("status");
    expect(order.filter((x) => x === "nodes")).toHaveLength(3);
    expect(order.filter((x) => x === "edges")).toHaveLength(2);
    expect(r.graph.nodes).toHaveLength(3);
  });

  it("announces a new attempt before re-streaming after an unusable reply", async () => {
    fetchMock.mockResolvedValueOnce(sse('{"kind":"architecture","nodes":[{"id":"a","label":"A"}],"edges":[]}'));
    fetchMock.mockResolvedValueOnce(sse(TEXT));
    const log: string[] = [];
    await generateGraph(input, cfg, {
      onStatus: (s) => log.push(`status:${s.attempt}`),
      onItem: (i) => log.push(i.kind === "item" ? `${i.section}` : i.kind),
    });
    const second = log.indexOf("status:2");
    expect(second).toBeGreaterThan(0);
    expect(log.slice(second)).toContain("edges");
  });
});
