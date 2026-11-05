import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as wellKnown } from "@/app/.well-known/ecosystem-connector.json/route";
import { GET as catchAll, POST as catchAllPost } from "@/app/api/connect/v1/[...path]/route";
import { GET as health } from "@/app/api/connect/v1/health/route";
import { GET as manifest } from "@/app/api/connect/v1/manifest/route";
import { GET as openapi } from "@/app/api/connect/v1/openapi.json/route";
import { connectorEnabled } from "@/lib/connector/config";
import { getCollections } from "@/lib/db/mongo";
import { disableConnector, req } from "./helpers/connector";
import { api } from "@/lib/client/api";
import { as, OWNER, setup, startDb, stopDb } from "./helpers/db";

/**
 * C22: with CONNECTOR_ENABLED off every connector route is a 404, the app behaves as before, and nothing
 * connector-related touches the database.
 */

const routes: [string, (r: Request) => Promise<Response>, string][] = [
  ["/.well-known/ecosystem-connector.json", wellKnown, "well-known"],
  ["/api/connect/v1/manifest", manifest, "manifest"],
  ["/api/connect/v1/health", health, "health"],
  ["/api/connect/v1/openapi.json", openapi, "openapi"],
  ["/api/connect/v1/anything/else", (r) => catchAll(r, { params: Promise.resolve({ path: ["anything", "else"] }) }), "catch-all GET"],
  ["/api/connect/v1/actions/boards.create", (r) => catchAllPost(r, { params: Promise.resolve({ path: ["actions", "boards.create"] }) }), "catch-all POST"],
];

describe("connector disabled", () => {
  beforeAll(() => {
    disableConnector();
    delete process.env.MONGODB_URI; // any database access from here on would fail the request with a 500
  });

  it("is off by default", () => {
    expect(connectorEnabled()).toBe(false);
  });

  for (const [path, handler, name] of routes) {
    it(`answers 404 in the CP1 error shape for ${name}`, async () => {
      const res = await handler(req(path, { method: path.includes("actions") ? "POST" : "GET", headers: { authorization: "Bearer cp1_slate_whatever", "x-request-id": "trace-1" } }));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-request-id")).toBe("trace-1");
      const body = await res.json();
      expect(body.error).toMatchObject({ code: "not_found", retryable: false, requestId: "trace-1" });
    });
  }
});

describe("connector disabled: the database layer", () => {
  beforeAll(startDb);
  afterAll(stopDb);

  it("builds none of the connector indexes (a cold start does exactly what it did before)", async () => {
    const c = await getCollections();
    const names = (await c.db.listCollections().toArray()).map((x) => x.name);
    expect(names.filter((n) => n.startsWith("connector_"))).toEqual([]);
    expect(names).toContain("slates"); // the regular indexes are still created
  });

  it("makes the settings panel's functions answer 'nothing here' without touching the connector collections", async () => {
    const { workspaceId } = await setup();
    expect(await as(OWNER).query(api.connector.overview, { workspaceId })).toBeNull();
    await expect(as(OWNER).mutation(api.connector.revoke, { grantId: "whatever" })).rejects.toThrow(/not available/);
    const c = await getCollections();
    expect((await c.db.listCollections().toArray()).filter((x) => x.name.startsWith("connector_"))).toEqual([]);
  });
});
