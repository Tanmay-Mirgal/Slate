import { describe, expect, it } from "vitest";
import { legacyToV2 } from "@/lib/canvas/legacy";
import type { CardEl, ConnectorEl, ShapeEl } from "@/lib/canvas/types";

describe("legacyToV2", () => {
  const legacy = [
    { id: "a", type: "node", nodeType: "database", title: "Users DB", subtitle: "Postgres", x: 100, y: 100, width: 180, height: 90, layerIndex: 2 },
    { id: "b", type: "node", nodeType: "server", title: "API", x: 400, y: 100, width: 180, height: 90, layerIndex: 3 },
    { id: "c", type: "arrow", startNodeId: "a", endNodeId: "b", connectorStyle: "orthogonal", sourceAnchor: "right", targetAnchor: "left", text: "reads", strokeColor: "#6B7280" },
    { id: "d", type: "rectangle", x: 10, y: 20, width: -50, height: 40, strokeColor: "#FFFFFF", fillColor: "#141414", text: "Box", layerIndex: 1 },
    { id: "e", type: "pencil", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }], strokeColor: "#ff0000", strokeWidth: 3 },
    { id: "f", type: "text", text: "Hello", x: 5, y: 6 },
    { id: "g", type: "arrow", x: 0, y: 0, width: 100, height: 50 },
    { id: "h", type: "mystery" },
    { id: "i", type: "arrow", startNodeId: "ghost", endNodeId: "b" },
  ];

  const { elements, skipped } = legacyToV2(legacy);
  const byId = new Map(elements.map((e) => [e.id, e]));

  it("converts nodes to cards with an icon derived from the node type", () => {
    const a = byId.get("a") as CardEl;
    expect(a.type).toBe("card");
    expect(a.icon).toBe("lucide:Database");
    expect(a.subtitle).toBe("Postgres");
  });

  it("keeps connector bindings, route and label", () => {
    const c = byId.get("c") as ConnectorEl;
    expect(c.start).toEqual({ id: "a", side: "right" });
    expect(c.end).toEqual({ id: "b", side: "left" });
    expect(c.route).toBe("elbow");
    expect(c.label).toBe("reads");
    expect(c.endHead).toBe("arrow");
  });

  it("normalises negative sizes and maps dark-theme literals to tokens", () => {
    const d = byId.get("d") as ShapeEl;
    expect(d.w).toBe(50);
    expect(d.x).toBe(-40);
    expect(d.stroke).toBe("ink");
    expect(d.fill).toBe("surface");
    expect(d.shape).toBe("rect");
  });

  it("turns pencil strokes into pen elements with relative points", () => {
    const e = byId.get("e");
    expect(e?.type).toBe("pen");
    if (e?.type === "pen") expect(e.pts.length).toBe(6);
  });

  it("skips unknown types and survives dangling references", () => {
    expect(byId.has("h")).toBe(false);
    expect(skipped).toBe(1);
    expect(byId.get("i")?.type).toBe("connector");
  });

  it("preserves layer order as z", () => {
    expect(byId.get("d")!.z).toBeLessThan(byId.get("a")!.z);
    expect(byId.get("a")!.z).toBeLessThan(byId.get("b")!.z);
  });

  it("tolerates garbage input", () => {
    expect(legacyToV2(null).elements).toEqual([]);
    expect(legacyToV2("nope").elements).toEqual([]);
    expect(legacyToV2([null, 1, "x", {}]).elements).toEqual([]);
  });
});
