import { requireScopes } from "@/lib/connector/auth/verify";
import { ok, tokenRoute } from "@/lib/connector/http";
import { loadOperation, operationWire, reapIfStale } from "@/lib/connector/operations";
import { findAction } from "@/lib/connector/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/connect/v1/operations/{id}: the state of an asynchronous action started by this connection. It needs
 * the same scopes as the action did.
 */
export const GET = tokenRoute<{ id: string }>({ route: "/operations/{id}" }, async (c) => {
  const op = await reapIfStale(await loadOperation(c.grant, c.params.id));
  const action = findAction(op.action);
  if (action) requireScopes(c.grant, action.scopes);
  return ok(operationWire(op));
});
