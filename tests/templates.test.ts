import { describe, expect, it } from "vitest";
import { TEMPLATES, matchTemplate } from "@/lib/diagram/templates";
import { parseDsl } from "@/lib/diagram/dsl";
import { findOverlaps, layoutGraph } from "@/lib/diagram/layout";
import { graphFromElements } from "@/lib/diagram/extract";
import { normalizeGraph } from "@/lib/diagram/graph";

describe("templates", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s parses and lays out without overlaps", async (_id, t) => {
    const { graph, errors } = parseDsl(t.dsl);
    expect(errors).toEqual([]);
    expect(graph.kind).toBe(t.kind);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
    if (graph.kind !== "sequence") expect(graph.edges.length).toBeGreaterThanOrEqual(3);
    // every referenced icon resolved (no silent drops)
    const result = await layoutGraph(normalizeGraph(graph).graph);
    expect(findOverlaps(result)).toEqual([]);
  });

  it("matches prompts to the closest template", () => {
    expect(matchTemplate("design a database schema for a blog with users and comments")?.id).toBe("blog-erd");
    expect(matchTemplate("ci/cd pipeline with docker and kubernetes")?.id).toBe("cicd-pipeline");
    expect(matchTemplate("xyzzy plugh")).toBeNull();
  });
});

describe("graphFromElements", () => {
  it("round-trips a generated diagram back into a graph", async () => {
    const t = TEMPLATES.find((x) => x.id === "microservices-ecommerce")!;
    const g0 = parseDsl(t.dsl).graph;
    const r = await layoutGraph(g0);
    const g1 = graphFromElements(r.elements);
    expect(g1.nodes.length).toBe(g0.nodes.length);
    expect(g1.edges.length).toBe(g0.edges.length);
    expect(g1.groups.length).toBe(g0.groups.length);
    // nodes keep their group membership
    const byLabel = new Map(g1.nodes.map((n) => [n.label, n]));
    expect(byLabel.get("PostgreSQL")?.group).toBeTruthy();
    expect(byLabel.get("Web app")?.group).toBe(byLabel.get("Mobile app")?.group);
  });
});
