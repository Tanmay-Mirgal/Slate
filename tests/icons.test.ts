import { describe, expect, it } from "vitest";
import { ICON_CATALOG, guessIcon, searchCatalog, iconKeysForPrompt } from "@/lib/canvas/icons-catalog";
import { getGlyph, lucideNodeToPath } from "@/lib/canvas/icons";

describe("icon catalog", () => {
  it("every catalog entry resolves to a drawable glyph", () => {
    const missing = ICON_CATALOG.filter((d) => !getGlyph(d.key)).map((d) => d.key);
    expect(missing).toEqual([]);
  });

  it("keys are unique", () => {
    const keys = ICON_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("guesses sensible icons for system design vocabulary", () => {
    expect(guessIcon("PostgreSQL primary")).toBe("brand:postgresql");
    expect(guessIcon("Redis cache")).toBe("brand:redis");
    expect(guessIcon("Apache Kafka broker")).toBe("brand:apachekafka");
    expect(guessIcon("Load Balancer")).toBe("lucide:Split");
    expect(guessIcon("Mobile app")).toBe("lucide:Smartphone");
    expect(guessIcon("S3 bucket")).toBe("svc:aws-s3");
    expect(guessIcon("zzzz qqqq")).toBeUndefined();
  });

  it("searches by alias", () => {
    expect(searchCatalog("k8s")[0]?.key).toBe("brand:kubernetes");
    expect(searchCatalog("postgres")[0]?.key).toBe("brand:postgresql");
    expect(searchCatalog("nonexistentthing")).toEqual([]);
  });

  it("prompt icon list stays compact", () => {
    expect(iconKeysForPrompt().length).toBeLessThan(14000);
  });

  it("converts primitive lucide nodes to path data", () => {
    const d = lucideNodeToPath([
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["line", { x1: "1", y1: "2", x2: "3", y2: "4" }],
      ["polyline", { points: "1 1 2 2 3 1" }],
      ["rect", { x: "1", y: "1", width: "4", height: "4", rx: "1" }],
    ]);
    expect(d).toContain("M2 12");
    expect(d).toContain("M1 2L3 4");
    expect(d).toContain("M1 1L2 2L3 1");
  });
});
