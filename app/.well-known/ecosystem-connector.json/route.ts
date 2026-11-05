import { ok, publicRoute } from "@/lib/connector/http";
import { connectorDocuments } from "@/lib/connector/registry/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /.well-known/ecosystem-connector.json: how the Hub discovers this service (public, cacheable for 5 minutes). */
export const GET = publicRoute({ route: "/.well-known/ecosystem-connector.json", cacheControl: "public, max-age=300" }, async () => ok(connectorDocuments().manifest));
