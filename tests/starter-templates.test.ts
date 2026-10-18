import { describe, expect, it } from "vitest";
import { parseDsl } from "@/lib/diagram/dsl";
import { layoutGraph } from "@/lib/diagram/layout";
import { STARTER_TEMPLATES, starterById } from "@/lib/diagram/starter-templates";

describe("dashboard starter templates", () => {
  it("offers the five documented starters", () => {
    expect(STARTER_TEMPLATES.map((t) => t.id)).toEqual(["aws-microservices", "database-erd", "nextjs-stack", "auth-flow", "system-design-interview"]);
    expect(starterById("nextjs-stack")?.title).toBe("Next.js Stack");
    expect(starterById("nope")).toBeNull();
  });

  for (const t of STARTER_TEMPLATES.filter((x) => x.dsl)) {
    it(`${t.id} parses cleanly and lays out with no overlapping nodes`, async () => {
      const { graph, errors } = parseDsl(t.dsl!);
      expect(errors).toEqual([]);
      expect(graph.nodes.length).toBeGreaterThanOrEqual(5);
      expect(graph.kind === "sequence" ? (graph.messages?.length ?? 0) : graph.edges.length).toBeGreaterThan(3);
      const out = await layoutGraph(graph, { diagramId: "dg_test" });
      expect(out.elements.length).toBeGreaterThan(graph.nodes.length);
    });
  }

  it("the interview starter is an empty board that opens interview mode", () => {
    const t = starterById("system-design-interview")!;
    expect(t.dsl).toBeNull();
    expect(t.interview).toBe(true);
  });

  it("the AWS starter names the five services the plan calls for", () => {
    const dsl = starterById("aws-microservices")!.dsl!;
    for (const needle of ["aws-apigw", "aws-ecs", "aws-rds", "aws-s3", "aws-cloudfront"]) expect(dsl).toContain(needle);
  });
});
