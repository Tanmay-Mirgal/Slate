import { connectorEnabled } from "@/lib/connector/config";
import { err } from "@/lib/connector/errors";
import { ok, publicRoute, tokenRoute } from "@/lib/connector/http";
import { registry } from "@/lib/connector/registry";
import { matchResource, type ResourceDef } from "@/lib/connector/registry/define";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { path: string[] };
type Ctx = { params: Promise<Params> };

/** Anything under /api/connect/v1 that nothing claims: a JSON 404, never an HTML page. */
const unknown = publicRoute<Params>({ route: "/{unknown}" }, async () => {
  throw err.notFound("Endpoint");
});

const API_PREFIX = /^\/api\/connect\/v1/;

/** The path below /api/connect/v1 exactly as sent (still percent-encoded), which is what resource patterns match. */
const relativePath = (req: Request) => new URL(req.url).pathname.replace(API_PREFIX, "") || "/";

const handlers = new Map<ResourceDef, (req: Request, ctx: Ctx) => Promise<Response>>();

/** One pipeline per resource (auth, rate limit, scope, audit), built from its registry declaration. */
function handlerFor(resource: ResourceDef) {
  let handler = handlers.get(resource);
  if (!handler) {
    handler = tokenRoute<Params>({ route: resource.path, scopes: resource.scopes }, async (c) => {
      const params = matchResource([resource], relativePath(c.req))?.params ?? {};
      const raw: Record<string, string> = {};
      for (const key of new Set(c.url.searchParams.keys())) {
        const values = c.url.searchParams.getAll(key);
        if (values.length > 1) throw err.validation(`Query parameter "${key}" must not be repeated`, [{ path: key, message: "Repeated parameter" }]);
        raw[key] = values[0];
      }
      const query = c.parse(resource.query, raw);
      return ok(await resource.handler({ grant: c.grant, params, requestId: c.requestId, ignoreUnknown: c.ignoreUnknown }, query));
    });
    handlers.set(resource, handler);
  }
  return handler;
}

/** GET /api/connect/v1/<any registered resource path>. */
export async function GET(req: Request, ctx: Ctx) {
  if (!connectorEnabled()) return unknown(req, ctx);
  const hit = matchResource(registry.resources, relativePath(req));
  return hit ? handlerFor(hit.resource)(req, ctx) : unknown(req, ctx);
}

export const POST = unknown;
export const PUT = unknown;
export const PATCH = unknown;
export const DELETE = unknown;
