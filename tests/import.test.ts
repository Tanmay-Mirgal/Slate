import { describe, expect, it } from "vitest";
import { layoutGraph } from "@/lib/diagram/layout";
import { aiImport, convertSource, detectSource, docFromGraph } from "@/lib/import";
import { composeToImport } from "@/lib/import/compose";
import { sqlToImport } from "@/lib/import/sql";
import { treeToImport } from "@/lib/import/tree";
import { markdownToTiptapContent } from "@/components/editor/markdown-parser";

const COMPOSE = `
name: shop
services:
  web:
    image: nginx:1.27-alpine
    ports:
      - "8080:80"
    depends_on:
      - api
    networks: [frontend]
  api:
    build: ./api
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://shop:supersecret@db:5432/shop
      REDIS_HOST: cache
      JWT_SECRET: hunter2hunter2
      LOG_LEVEL: \${LOG_LEVEL:-info}
      STRIPE_KEY: \${STRIPE_KEY:?set it}
    depends_on:
      db:
        condition: service_healthy
      cache: {}
    networks: [frontend, backend]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
    restart: unless-stopped
  worker:
    build:
      context: ./worker
    deploy:
      replicas: 3
    environment:
      - AMQP_URL=amqp://guest:guest@queue:5672
    networks: [backend]
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [backend]
  cache:
    image: redis:7
    networks: [backend]
  queue:
    image: rabbitmq:3-management
    networks: [backend]
networks:
  frontend: {}
  backend: {}
volumes:
  pgdata: {}
`;

describe("docker-compose import", () => {
  const result = composeToImport(COMPOSE)!;

  it("detects compose files and nothing else", () => {
    expect(detectSource(COMPOSE)).toBe("compose");
    expect(detectSource("hello world")).toBe("unknown");
    expect(detectSource("")).toBe("unknown");
    expect(composeToImport("services:\n  - not: [valid")).toBeNull();
  });

  it("turns services into nodes, with an entry point for published ports", () => {
    const labels = result.graph.nodes.map((n) => n.label);
    for (const s of ["web", "api", "worker", "db", "cache", "queue", "Clients", "pgdata"]) expect(labels).toContain(s);
    expect(result.graph.kind).toBe("architecture");
    expect(result.title).toBe("shop stack");
    expect(result.graph.nodes.find((n) => n.label === "db")?.icon).toBe("brand:postgresql");
    expect(result.graph.nodes.find((n) => n.label === "cache")?.icon).toBe("brand:redis");
    expect(result.graph.nodes.find((n) => n.label === "worker")?.subtitle).toMatch(/3 replicas/);
  });

  it("derives edges from depends_on and from hostnames in environment values", () => {
    const edge = (from: string, to: string) => result.graph.edges.find((e) => e.from === from && e.to === to);
    expect(edge("web", "api")?.style).toBe("dashed");
    expect(edge("api", "db")?.label).toBe("SQL");
    expect(edge("api", "db")?.style).toBe("solid");
    expect(edge("api", "cache")).toBeTruthy(); // REDIS_HOST: cache
    expect(edge("worker", "queue")?.label).toBe("AMQP");
    expect(edge("clients", "web")?.label).toBe(":8080");
    expect(edge("api", "pgdata")).toBeUndefined();
    expect(result.graph.edges.some((e) => e.to === "vol_pgdata")).toBe(true);
  });

  it("groups services by custom network and lays out cleanly", async () => {
    expect(result.graph.groups.map((g) => g.label).sort()).toEqual(["backend network", "frontend network"]);
    const out = await layoutGraph(result.graph, { diagramId: "dg_x" });
    expect(out.elements.length).toBeGreaterThan(result.graph.nodes.length);
  });

  it("writes documentation without leaking secrets", () => {
    const md = result.markdown;
    expect(md).toContain("# shop stack");
    expect(md).toContain("## Port map");
    expect(md).toContain("## Environment requirements");
    expect(md).toContain("docker compose up -d");
    expect(md).toContain("`JWT_SECRET`");
    expect(md).toMatch(/JWT_SECRET[^\n]*Secret/);
    expect(md).toMatch(/LOG_LEVEL[^\n]*Defaults to `info`/);
    expect(md).toMatch(/STRIPE_KEY[^\n]*Required/);
    for (const leaked of ["supersecret", "hunter2hunter2", "guest:guest"]) expect(md).not.toContain(leaked);
  });

  it("produces markdown the editor can parse (headings, tables, code)", () => {
    const doc = markdownToTiptapContent(result.markdown);
    const types = new Set((doc.content ?? []).map((n) => n.type));
    expect(types.has("heading")).toBe(true);
    expect(types.has("table")).toBe(true);
    expect(types.has("codeBlock")).toBe(true);
  });

  it("does not invent edges from unrelated variable values", () => {
    const r = composeToImport(`services:\n  api:\n    image: node\n    environment:\n      SERVICE_NAME: web\n  web:\n    image: nginx\n`)!;
    expect(r.graph.edges.filter((e) => e.from === "api" && e.to === "web")).toEqual([]);
  });
});

const SQL = `
-- billing schema
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name varchar(120)
);
CREATE TABLE IF NOT EXISTS public."workspaces" (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text
);
CREATE TABLE subscriptions (
  id uuid,
  workspace_id uuid NOT NULL,
  plan text DEFAULT 'free',
  amount numeric(10, 2),
  PRIMARY KEY (id),
  CONSTRAINT fk_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);
CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  subscription_id uuid,
  coupon_id uuid REFERENCES coupons(id)
);
ALTER TABLE invoices ADD CONSTRAINT inv_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions(id);
`;

describe("SQL schema import", () => {
  const result = sqlToImport(SQL)!;

  it("reads tables, keys and types", () => {
    expect(detectSource(SQL)).toBe("sql");
    expect(result.graph.kind).toBe("erd");
    expect(result.graph.nodes.map((n) => n.label)).toEqual(["users", "workspaces", "subscriptions", "invoices"]);
    const users = result.graph.nodes.find((n) => n.id === "users")!;
    expect(users.fields?.find((f) => f.name === "id")?.key).toBe("pk");
    expect(users.fields?.find((f) => f.name === "email")?.key).toBe("unique");
    const subs = result.graph.nodes.find((n) => n.id === "subscriptions")!;
    expect(subs.fields?.find((f) => f.name === "id")?.key).toBe("pk"); // table-level PRIMARY KEY (id)
    expect(subs.fields?.find((f) => f.name === "workspace_id")?.key).toBe("fk"); // named table constraint
    expect(subs.fields?.find((f) => f.name === "amount")?.type).toBe("numeric(10, 2)");
  });

  it("links parents to children, including ALTER TABLE keys, and warns about missing tables", () => {
    const has = (from: string, to: string) => result.graph.edges.some((e) => e.from === from && e.to === to);
    expect(has("users", "workspaces")).toBe(true);
    expect(has("workspaces", "subscriptions")).toBe(true);
    expect(has("subscriptions", "invoices")).toBe(true);
    expect(result.graph.edges.every((e) => e.label === "1 : N")).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/coupons/);
  });

  it("documents every column and relationship", () => {
    expect(result.markdown).toContain("### subscriptions");
    expect(result.markdown).toContain("foreign key → workspaces.id");
    expect(result.markdown).toContain("## Relationships");
    expect(result.markdown).toMatch(/`users` has many `workspaces`/);
  });

  it("ignores text that isn't DDL", () => {
    expect(sqlToImport("SELECT * FROM users")).toBeNull();
  });
});

const TREE = `my-app/
├── app/
│   ├── dashboard/
│   │   └── page.tsx
│   └── api/
│       └── route.ts
├── components/
│   ├── Button.tsx
│   └── Card.tsx
├── lib/
│   └── utils.ts
├── tests/
│   └── utils.test.ts
├── Dockerfile
├── package.json
└── next.config.ts
`;

describe("directory tree import", () => {
  const result = treeToImport(TREE)!;

  it("recognises tree output", () => {
    expect(detectSource(TREE)).toBe("tree");
    expect(detectSource("const a = 1;\nconst b = 2;\nfunction x() {}")).toBe("unknown");
  });

  it("draws folders as a mind map rooted at the project", () => {
    expect(result.graph.kind).toBe("mindmap");
    expect(result.title).toBe("my-app structure");
    const labels = result.graph.nodes.map((n) => n.label);
    for (const l of ["my-app", "app", "dashboard", "api", "components", "lib", "tests", "package.json", "Dockerfile"]) expect(labels).toContain(l);
    expect(result.graph.nodes.find((n) => n.label === "components")?.subtitle).toMatch(/2 files/);
    const root = result.graph.nodes.find((n) => n.label === "my-app")!;
    expect(result.graph.edges.filter((e) => e.from === root.id).length).toBeGreaterThanOrEqual(5);
  });

  it("documents the stack and what the folders are for", () => {
    expect(result.markdown).toContain("Next.js");
    expect(result.markdown).toContain("Docker");
    expect(result.markdown).toMatch(/`components\/`[^\n]*Reusable UI components/);
    expect(result.markdown).toContain("```text");
  });

  it("handles plain indentation", () => {
    const plain = treeToImport("src/\n  index.ts\n  utils/\n    math.ts\n    text.ts\ndocs/\n  readme.md\n")!;
    expect(plain.graph.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(["src", "utils", "docs"]));
  });
});

describe("dispatch and AI fallback docs", () => {
  it("convertSource picks the right importer and returns null for free text", () => {
    expect(convertSource(COMPOSE)?.source).toBe("compose");
    expect(convertSource(SQL)?.source).toBe("sql");
    expect(convertSource(TREE)?.source).toBe("tree");
    expect(convertSource("a Flask app with a Celery worker and Redis")).toBeNull();
  });

  it("builds documentation for a model-made graph", () => {
    const r = aiImport(
      {
        kind: "architecture",
        title: "Checkout",
        direction: "right",
        nodes: [
          { id: "api", label: "API", subtitle: "Flask" },
          { id: "redis", label: "Redis" },
          { id: "w", label: "Worker", group: "bg" },
        ],
        groups: [{ id: "bg", label: "Background" }],
        edges: [
          { from: "api", to: "redis", label: "enqueue" },
          { from: "redis", to: "w", style: "dashed" },
        ],
      },
      []
    );
    expect(r.source).toBe("ai");
    expect(r.markdown).toContain("# Checkout");
    expect(r.markdown).toContain("## Connections");
    expect(r.markdown).toMatch(/`API` → `Redis`: enqueue/);
    expect(r.markdown).toContain("_(asynchronous)_");
    expect(docFromGraph({ ...r.graph, groups: [] })).not.toContain("## Boundaries");
  });
});
