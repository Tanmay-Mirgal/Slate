import { describe, expect, it } from "vitest";
import { cardSize, createCard, createConnector, DEFAULT_STYLE } from "@/lib/canvas/create";
import type { El } from "@/lib/canvas/types";
import { declaredCopies, familyKey, kindOf } from "@/lib/cloud/classify";
import { estimateCost, toCsv } from "@/lib/finops/estimate";
import { formatUsd, ruleFor } from "@/lib/finops/pricing-rules";
import { articulationPoints, buildTopology, findSpofs } from "@/lib/simulation/topology";

let z = 1;
const card = (title: string, subtitle = "", icon = ""): El => createCard({ x: 0, y: 0, ...cardSize(title, subtitle, true) }, z++, { title, subtitle, icon: icon || undefined });
const link = (a: El, b: El, over: Partial<ReturnType<typeof createConnector>> = {}): El => ({ ...createConnector({ x: 0, y: 0 }, { x: 10, y: 10 }, DEFAULT_STYLE, z++, { start: { id: a.id }, end: { id: b.id } }), ...over }) as El;

describe("classification", () => {
  it("recognises common components", () => {
    const k = (label: string, icon = "", subtitle = "") => kindOf({ id: "x", label, subtitle, icon });
    expect(k("PostgreSQL", "brand:postgresql")).toBe("database");
    expect(k("Redis")).toBe("cache");
    expect(k("Kafka", "brand:apachekafka")).toBe("queue");
    expect(k("API gateway")).toBe("gateway");
    expect(k("Auth service")).toBe("auth");
    expect(k("Web client")).toBe("client");
    expect(k("Orders service")).toBe("compute");
  });

  it("reads declared redundancy from labels", () => {
    const c = (label: string, subtitle = "") => declaredCopies({ id: "x", label, subtitle, icon: "" });
    expect(c("API")).toBe(1);
    expect(c("API x3")).toBe(3);
    expect(c("Workers", "4 instances")).toBe(4);
    expect(c("Aurora", "Multi-AZ")).toBe(2);
    expect(c("Web servers", "Auto Scaling group")).toBe(2);
    expect(c("Redis", "cluster")).toBe(3);
  });

  it("groups numbered siblings", () => {
    expect(familyKey("API 1")).toBe(familyKey("API 2"));
    expect(familyKey("api_a")).toBe(familyKey("api_b"));
    expect(familyKey("Auth")).not.toBe(familyKey("Orders"));
  });
});

describe("FinOps estimate", () => {
  it("prices cloud services by icon and by name", () => {
    expect(ruleFor({ label: "Anything", subtitle: "", icon: "svc:aws-s3" })?.id).toBe("aws-s3");
    expect(ruleFor({ label: "NAT Gateway", subtitle: "", icon: "" })?.id).toBe("aws-nat");
    expect(ruleFor({ label: "Cloud Run service", subtitle: "", icon: "" })?.id).toBe("gcp-run");
    expect(ruleFor({ label: "PostgreSQL", subtitle: "", icon: "brand:postgresql" })?.provider).toBe("generic");
    expect(ruleFor({ label: "Sticky note", subtitle: "", icon: "" })).toBeNull();
  });

  it("totals the board and ignores things it can't price", () => {
    const els = [card("Web", "", "svc:aws-ec2"), card("ALB", "", "svc:aws-elb"), card("DB", "", "svc:aws-rds"), card("Notes")];
    const est = estimateCost(els);
    expect(est.items).toHaveLength(3);
    expect(est.total).toBeCloseTo(24.53 + 22 + 65, 2);
    expect(est.byProvider.aws).toBeCloseTo(est.total, 2);
    expect(estimateCost([card("Notes")]).total).toBe(0);
    expect(estimateCost([]).items).toEqual([]);
  });

  it("multiplies by the copies a label declares", () => {
    const est = estimateCost([card("Web servers x3", "", "svc:aws-ec2")]);
    expect(est.items[0].quantity).toBe(3);
    expect(est.total).toBeCloseTo(24.53 * 3, 2);
  });

  it("flags unpriced cloud services instead of silently dropping them", () => {
    expect(estimateCost([card("DB", "", "svc:aws-rds"), card("Thing", "", "svc:aws-unknown-thing")]).unpriced).toBe(1);
  });

  it("suggests the NAT gateway to VPC endpoint swap", () => {
    const est = estimateCost([card("NAT Gateway"), card("Assets", "", "svc:aws-s3")]);
    const tip = est.tips.find((t) => t.id === "nat-endpoint");
    expect(tip?.savings).toBeGreaterThan(25);
    expect(tip?.message).toMatch(/NAT Gateway/);
  });

  it("recommends consolidating load balancers", () => {
    const est = estimateCost([card("ALB 1", "", "svc:aws-elb"), card("ALB 2", "", "svc:aws-elb")]);
    expect(est.tips.some((t) => t.id === "consolidate-alb")).toBe(true);
  });

  it("exports an escaped CSV with a total row", () => {
    const csv = toCsv(estimateCost([card('Orders, "primary"', "", "svc:aws-rds")]));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Component,Provider,Service,Quantity,Monthly USD,Assumption");
    expect(lines[1].startsWith('"Orders, ""primary"""')).toBe(true);
    expect(lines[lines.length - 1].startsWith("Total,")).toBe(true);
  });

  it("formats dollars compactly", () => {
    expect(formatUsd(428.4)).toBe("$428");
    expect(formatUsd(24.53)).toBe("$24.53");
    expect(formatUsd(1234.5)).toBe("$1,235");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("topology and single points of failure", () => {
  it("flags a service that many clients depend on and has no replica", () => {
    const [a, b, c, d] = ["Web app", "Mobile app", "Admin app", "Partner API"].map((t) => card(t));
    const auth = card("Auth Service", "", "lucide:ShieldCheck");
    const db = card("PostgreSQL", "", "brand:postgresql");
    const spofs = findSpofs([a, b, c, d, auth, db, link(a, auth), link(b, auth), link(c, auth), link(d, auth), link(auth, db)]);
    const authSpof = spofs.find((s) => s.label === "Auth Service");
    expect(authSpof).toMatchObject({ dependents: 4, replicas: 0, severity: "high" });
    expect(authSpof?.message).toBe("Auth Service has 4 dependent clients and 0 replicas");
  });

  it("does not flag redundant or managed components", () => {
    const c1 = card("Web");
    const c2 = card("Mobile");
    const api = card("API x3");
    const s3 = card("Assets", "", "svc:aws-s3");
    const db = card("Aurora", "Multi-AZ", "svc:aws-rds");
    const spofs = findSpofs([c1, c2, api, s3, db, link(c1, api), link(c2, api), link(api, s3), link(api, db), link(c1, s3), link(c2, s3)]);
    expect(spofs.map((s) => s.label)).toEqual([]);
  });

  it("treats numbered siblings as replicas", () => {
    const c1 = card("Client A");
    const c2 = card("Client B");
    const a1 = card("API 1");
    const a2 = card("API 2");
    const topo = buildTopology([c1, c2, a1, a2, link(c1, a1), link(c1, a2), link(c2, a1), link(c2, a2)]);
    expect(topo.nodes.get(a1.id)?.copies).toBe(2);
    expect(findSpofs([c1, c2, a1, a2, link(c1, a1), link(c1, a2), link(c2, a1), link(c2, a2)])).toEqual([]);
  });

  it("flags a lone database even with one caller, but not an entry point", () => {
    const client = card("Web client");
    const api = card("Orders API");
    const db = card("PostgreSQL", "", "brand:postgresql");
    const spofs = findSpofs([client, api, db, link(client, api), link(api, db)]);
    const labels = spofs.map((s) => s.label);
    expect(labels).toContain("PostgreSQL");
    expect(labels).not.toContain("Web client");
  });

  it("ignores connectors that aren't bound at both ends, and respects arrow direction", () => {
    const a = card("A service");
    const b = card("B service");
    const loose = createConnector({ x: 0, y: 0 }, { x: 5, y: 5 }, DEFAULT_STYLE, 99, { start: { id: a.id } });
    expect(buildTopology([a, b, loose]).edges).toEqual([]);
    const reversed = link(a, b, { startHead: "arrow", endHead: "none" });
    const topo = buildTopology([a, b, reversed]);
    expect(topo.nodes.get(a.id)?.callers.has(b.id)).toBe(true);
    expect(topo.nodes.get(b.id)?.callees.has(a.id)).toBe(true);
  });

  it("finds articulation points of a chain", () => {
    const [a, b, c] = ["A", "B", "C"].map((t) => card(t));
    const topo = buildTopology([a, b, c, link(a, b), link(b, c)]);
    expect(Array.from(articulationPoints(topo))).toEqual([b.id]);
  });
});
