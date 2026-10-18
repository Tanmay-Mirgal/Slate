import { describe, expect, it } from "vitest";
import { DSL_EXAMPLE, graphToDsl, parseDsl } from "@/lib/diagram/dsl";
import { layoutGraph, findOverlaps } from "@/lib/diagram/layout";

describe("diagram DSL", () => {
  it("parses groups, properties, chains, labels and operators", () => {
    const { graph, errors } = parseDsl(`
      title Demo
      type architecture
      direction right
      Edge [color: blue] {
        CDN [icon: cloudflare]
        API gateway [subtitle: "Auth, rate limiting"]
      }
      Client > CDN > API gateway: HTTPS
      API gateway <> Redis
      API gateway --> Kafka: events
      A, B > C
      // a comment
      X - Y
    `);
    expect(errors).toEqual([]);
    expect(graph.title).toBe("Demo");
    expect(graph.direction).toBe("right");
    expect(graph.groups.map((g) => g.label)).toEqual(["Edge"]);
    const cdn = graph.nodes.find((n) => n.label === "CDN")!;
    expect(cdn.group).toBe("edge");
    expect(cdn.icon).toBe("brand:cloudflare");
    expect(graph.nodes.find((n) => n.label === "API gateway")!.subtitle).toBe("Auth, rate limiting");
    const find = (a: string, b: string) => graph.edges.find((e) => graph.nodes.find((n) => n.id === e.from)!.label === a && graph.nodes.find((n) => n.id === e.to)!.label === b)!;
    expect(find("Client", "CDN").arrow).toBe("forward");
    expect(find("CDN", "API gateway").label).toBe("HTTPS");
    expect(find("API gateway", "Redis").arrow).toBe("both");
    expect(find("API gateway", "Kafka").style).toBe("dashed");
    expect(find("A", "C")).toBeTruthy();
    expect(find("B", "C")).toBeTruthy();
    expect(find("X", "Y").arrow).toBe("none");
  });

  it("does not split on hyphens inside names", () => {
    const { graph } = parseDsl("api-gateway > user-service");
    expect(graph.nodes.map((n) => n.label)).toEqual(["api-gateway", "user-service"]);
    expect(graph.edges).toHaveLength(1);
  });

  it("parses ER entities with keys", () => {
    const { graph, errors } = parseDsl(`
      type erd
      users {
        id uuid pk
        email text unique
        org_id uuid fk
      }
      orgs { id uuid pk }
      orgs > users: 1:N
    `);
    expect(errors).toEqual([]);
    const users = graph.nodes.find((n) => n.label === "users")!;
    expect(users.fields).toEqual([
      { name: "id", type: "uuid", key: "pk" },
      { name: "email", type: "text", key: "unique" },
      { name: "org_id", type: "uuid", key: "fk" },
    ]);
    expect(graph.edges[0].label).toBe("1:N");
  });

  it("parses sequence diagrams into ordered messages", () => {
    const { graph } = parseDsl(`
      type sequence
      User > App: click
      App > API: POST /orders
      API --> App: 201
    `);
    expect(graph.messages).toHaveLength(3);
    expect(graph.messages![2].kind).toBe("return");
    expect(graph.nodes.map((n) => n.label)).toEqual(["User", "App", "API"]);
  });

  it("reports unclosed blocks and stray braces", () => {
    expect(parseDsl("Group {\n A").errors.length).toBeGreaterThan(0);
    expect(parseDsl("}").errors[0].message).toMatch(/Unexpected/);
  });

  it("round-trips through the serialiser", () => {
    const first = parseDsl(DSL_EXAMPLE).graph;
    const text = graphToDsl(first);
    const second = parseDsl(text).graph;
    expect(second.nodes.map((n) => n.label).sort()).toEqual(first.nodes.map((n) => n.label).sort());
    expect(second.edges).toHaveLength(first.edges.length);
    expect(second.groups.map((g) => g.label)).toEqual(first.groups.map((g) => g.label));
  });

  it("the bundled example lays out cleanly", async () => {
    const r = await layoutGraph(parseDsl(DSL_EXAMPLE).graph);
    expect(findOverlaps(r)).toEqual([]);
  });
});
