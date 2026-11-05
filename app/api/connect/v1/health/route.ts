import { CONNECTOR_VERSION } from "@/lib/connector/config";
import { ok, publicRoute } from "@/lib/connector/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connect/v1/health: liveness only. No secrets and no tenant data. */
export const GET = publicRoute({ route: "/health" }, async () => ok({ status: "ok", version: CONNECTOR_VERSION, time: new Date().toISOString() }));
