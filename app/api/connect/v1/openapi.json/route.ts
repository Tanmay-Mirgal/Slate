import { ok, publicRoute } from "@/lib/connector/http";
import { connectorDocuments } from "@/lib/connector/registry/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connect/v1/openapi.json: OpenAPI 3.1, generated from the same registry as the manifest. */
export const GET = publicRoute({ route: "/openapi.json", cacheControl: "public, max-age=300" }, async () => ok(connectorDocuments().openapi));
