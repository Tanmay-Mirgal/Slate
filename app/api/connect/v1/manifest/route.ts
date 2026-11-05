import { ok, publicRoute } from "@/lib/connector/http";
import { connectorDocuments } from "@/lib/connector/registry/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connect/v1/manifest: the same document as /.well-known/ecosystem-connector.json. */
export const GET = publicRoute({ route: "/manifest", cacheControl: "public, max-age=300" }, async () => ok(connectorDocuments().manifest));
