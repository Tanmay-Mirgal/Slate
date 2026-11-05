import { ok, tokenRoute } from "@/lib/connector/http";
import { buildMe } from "@/lib/connector/resources/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connect/v1/me: any valid token. Who the connection acts as, its live scopes, the plan and what it can do. */
export const GET = tokenRoute({ route: "/me" }, async (c) => ok(await buildMe(c.grant)));
