import { describe, expect, it } from "vitest";
import { normalizeGraph, type Graph } from "@/lib/diagram/graph";
import { findOverlaps, layoutGraph, type LayoutResult } from "@/lib/diagram/layout";
import { resolveConnector, sceneFromElements } from "@/lib/canvas/router";
import { segmentIntersectsRect } from "@/lib/canvas/geometry";
import type { ConnectorEl, El } from "@/lib/canvas/types";

const arch = (): Graph =>
  normalizeGraph({
    kind: "architecture",
    title: "E-commerce platform",
    groups: [
      { id: "edge", label: "Edge" },
      { id: "core", label: "Core services" },
      { id: "orders", label: "Order domain", parent: "core" },
      { id: "data", label: "Data layer" },
    ],
    nodes: [
      { id: "web", label: "Web app", subtitle: "Next.js", icon: "nextdotjs" },
      { id: "mobile", label: "Mobile app", subtitle: "React Native" },
      { id: "cdn", label: "CDN", group: "edge", icon: "cloudflare" },
      { id: "gw", label: "API gateway", subtitle: "Rate limiting · authn", group: "edge" },
      { id: "auth", label: "Auth service", group: "core", subtitle: "JWT + OAuth" },
      { id: "catalog", label: "Catalog service", group: "core" },
      { id: "orders", label: "Order service", group: "orders" },
      { id: "payments", label: "Payment service", group: "orders", subtitle: "Stripe" },
      { id: "inventory", label: "Inventory service", group: "orders" },
      { id: "pg", label: "PostgreSQL", group: "data", subtitle: "Orders + users" },
      { id: "redis", label: "Redis", group: "data", subtitle: "Sessions & cache" },
      { id: "kafka", label: "Kafka", group: "data", subtitle: "Order events" },
      { id: "search", label: "Elasticsearch", group: "data" },
      { id: "worker", label: "Fulfilment worker", group: "core" },
      { id: "email", label: "Email provider", subtitle: "SendGrid" },
    ],
    edges: [
      { from: "web", to: "cdn", label: "HTTPS" },
      { from: "mobile", to: "gw", label: "HTTPS" },
      { from: "cdn", to: "gw" },
      { from: "gw", to: "auth", label: "verify token" },
      { from: "gw", to: "catalog" },
      { from: "gw", to: "orders" },
      { from: "orders", to: "payments", label: "charge" },
      { from: "orders", to: "inventory", label: "reserve" },
      { from: "orders", to: "pg", label: "SQL" },
      { from: "auth", to: "redis" },
      { from: "catalog", to: "search" },
      { from: "orders", to: "kafka", label: "OrderPlaced", style: "dashed" },
      { from: "kafka", to: "worker", style: "dashed" },
      { from: "worker", to: "email" },
      { from: "payments", to: "pg" },
    ],
  }).graph;

function stress(n: number, seed = 7): Graph {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `Service ${i} with a fairly long descriptive name`,
    subtitle: i % 3 === 0 ? "Node.js · gRPC" : undefined,
    group: i % 7 < 3 ? `g${i % 3}` : undefined,
  }));
  const edges: { from: string; to: string; label?: string }[] = [];
  for (let i = 1; i < n; i++) edges.push({ from: `n${Math.floor(rnd() * i)}`, to: `n${i}`, label: i % 4 === 0 ? "calls" : undefined });
  for (let i = 0; i < n / 2; i++) edges.push({ from: `n${Math.floor(rnd() * n)}`, to: `n${Math.floor(rnd() * n)}` });
  return normalizeGraph({ kind: "architecture", groups: [{ id: "g0", label: "A" }, { id: "g1", label: "B" }, { id: "g2", label: "C" }], nodes, edges }).graph;
}

function assertClean(r: LayoutResult) {
  expect(findOverlaps(r)).toEqual([]);
}

/** No connector may pass through a node it is not attached to. */
function foreignCrossings(r: LayoutResult): string[] {
  const els: El[] = r.elements;
  const scene = sceneFromElements(els);
  const nodes = els.filter((e) => e.type !== "connector" && e.type !== "frame");
  const bad: string[] = [];
  for (const c of els.filter((e): e is ConnectorEl => e.type === "connector")) {
    if (!c.start || !c.end) continue;
    const geom = resolveConnector(c, scene);
    for (const n of nodes) {
      if (n.id === c.start.id || n.id === c.end.id) continue;
      const inner = { x: n.x + 2, y: n.y + 2, w: n.w - 4, h: n.h - 4 };
      for (let i = 0; i < geom.pts.length - 1; i++) {
        if (segmentIntersectsRect(geom.pts[i], geom.pts[i + 1], inner)) {
          bad.push(`${c.id} crosses ${n.id}`);
          break;
        }
      }
    }
  }
  return bad;
}

describe("diagram layout", () => {
  it("lays out a grouped architecture without any overlaps", async () => {
    const r = await layoutGraph(arch());
    expect(r.elements.filter((e) => e.type === "card")).toHaveLength(15);
    expect(r.elements.filter((e) => e.type === "frame")).toHaveLength(4);
    expect(r.elements.filter((e) => e.type === "connector")).toHaveLength(15);
    assertClean(r);
  });

  it("keeps nested groups inside their parent frame", async () => {
    const r = await layoutGraph(arch());
    const core = r.elements.find((e) => e.id.endsWith(":g:core"))!;
    const orders = r.elements.find((e) => e.id.endsWith(":g:orders"))!;
    expect(orders.x).toBeGreaterThanOrEqual(core.x);
    expect(orders.y).toBeGreaterThanOrEqual(core.y);
    expect(orders.x + orders.w).toBeLessThanOrEqual(core.x + core.w);
    expect(orders.y + orders.h).toBeLessThanOrEqual(core.y + core.h);
  });

  it("routes connectors around unrelated nodes", async () => {
    const r = await layoutGraph(arch());
    expect(foreignCrossings(r)).toEqual([]);
  });

  it("is deterministic about structure and stays compact", async () => {
    const r = await layoutGraph(arch());
    const aspect = r.bounds.w / r.bounds.h;
    expect(aspect).toBeGreaterThan(0.35);
    expect(aspect).toBeLessThan(3.6);
  });

  it.each([12, 30, 60])("stays overlap-free for random graphs with %i nodes", async (n) => {
    const r = await layoutGraph(stress(n, n));
    assertClean(r);
    expect(foreignCrossings(r)).toEqual([]);
  });

  it("lays out a flowchart with decisions", async () => {
    const g = normalizeGraph({
      kind: "flowchart",
      nodes: [
        { id: "s", label: "Start", shape: "terminator" },
        { id: "a", label: "User submits login form" },
        { id: "d", label: "Credentials valid?", shape: "decision" },
        { id: "m", label: "Needs MFA?", shape: "decision" },
        { id: "ok", label: "Create session", shape: "process" },
        { id: "err", label: "Show error and count attempt", shape: "process" },
        { id: "e", label: "End", shape: "terminator" },
      ],
      edges: [
        { from: "s", to: "a" },
        { from: "a", to: "d" },
        { from: "d", to: "m", label: "Yes" },
        { from: "d", to: "err", label: "No" },
        { from: "m", to: "ok", label: "No" },
        { from: "ok", to: "e" },
        { from: "err", to: "a" },
      ],
    }).graph;
    const r = await layoutGraph(g);
    expect(r.elements.filter((e) => e.type === "shape")).toHaveLength(7);
    assertClean(r);
  });

  it("lays out an ER diagram with table elements", async () => {
    const g = normalizeGraph({
      kind: "erd",
      nodes: [
        { id: "users", label: "users", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "email", type: "text", key: "unique" }, { name: "org_id", type: "uuid", key: "fk" }] },
        { id: "orgs", label: "organizations", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "name", type: "text" }] },
        { id: "posts", label: "posts", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "author_id", type: "uuid", key: "fk" }, { name: "body", type: "text" }] },
      ],
      edges: [
        { from: "orgs", to: "users", label: "1 : N" },
        { from: "users", to: "posts", label: "1 : N" },
      ],
    }).graph;
    const r = await layoutGraph(g);
    expect(r.elements.filter((e) => e.type === "table")).toHaveLength(3);
    assertClean(r);
  });

  it("lays out a mind map radially without overlaps", async () => {
    const nodes = [{ id: "root", label: "Launch plan" }];
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 6; i++) {
      nodes.push({ id: `b${i}`, label: `Branch ${i}` });
      edges.push({ from: "root", to: `b${i}` });
      for (let j = 0; j < 3; j++) {
        nodes.push({ id: `b${i}c${j}`, label: `Leaf ${i}.${j} with longer text` });
        edges.push({ from: `b${i}`, to: `b${i}c${j}` });
      }
    }
    const r = await layoutGraph(normalizeGraph({ kind: "mindmap", nodes, edges }).graph);
    assertClean(r);
  });

  it("lays out a sequence diagram with growing time", async () => {
    const g = normalizeGraph({
      kind: "sequence",
      nodes: [{ id: "u", label: "User" }, { id: "app", label: "Web app" }, { id: "api", label: "API" }, { id: "db", label: "Database" }],
      messages: [
        { from: "u", to: "app", label: "Click checkout" },
        { from: "app", to: "api", label: "POST /orders" },
        { from: "api", to: "db", label: "INSERT order" },
        { from: "db", to: "api", label: "row id", kind: "return" },
        { from: "api", to: "api", label: "validate stock" },
        { from: "api", to: "app", label: "201 Created", kind: "return" },
      ],
    }).graph;
    const r = await layoutGraph(g);
    expect(r.direction).toBe("sequence");
    const msgs = r.elements.filter((e): e is ConnectorEl => e.type === "connector" && e.id.includes(":m"));
    expect(msgs).toHaveLength(6);
    const ys = msgs.map((m) => m.points[0].y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    assertClean(r);
  });
});

describe("graph normalisation", () => {
  it("accepts the messy shapes models actually produce", () => {
    const { graph, warnings } = normalizeGraph({
      diagramType: "HLD",
      nodes: [
        { id: "A", title: "Auth API", technologies: ["Node.js", "Express"], category: "backend" },
        { id: "A", title: "Duplicate id" },
        "Plain string node",
      ],
      edges: [
        { source: "A", target: "Billing", protocol: "REST" },
        { source: "A", target: "A" },
        { source: "Missing", target: "Plain string node" },
      ],
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "a_", "plain_string_node", "billing", "missing"]);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes[0].subtitle).toBe("Node.js · Express");
    expect(warnings.some((w) => w.includes("Billing"))).toBe(true);
  });

  it("breaks group cycles and removes empty groups", () => {
    const { graph } = normalizeGraph({
      groups: [{ id: "a", label: "A", parent: "b" }, { id: "b", label: "B", parent: "a" }, { id: "empty", label: "Nothing here" }],
      nodes: [{ id: "x", label: "X", group: "a" }],
    });
    expect(graph.groups.map((g) => g.id)).toEqual(["a"]);
    expect(graph.groups[0].parent).toBeUndefined();
  });

  it("caps sizes", () => {
    const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
    expect(normalizeGraph({ nodes }).graph.nodes.length).toBeLessThanOrEqual(90);
  });
});
