import { z } from "zod";
import { requireScopes } from "@/lib/connector/auth/verify";
import { err } from "@/lib/connector/errors";
import { ok, tokenRoute } from "@/lib/connector/http";
import { deferTask } from "@/lib/connector/defer";
import { createOperation, operationWire, runOperation } from "@/lib/connector/operations";
import { findAction } from "@/lib/connector/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds. Asynchronous actions keep working after the `202`, up to this long (model calls are slow). */
export const maxDuration = 120;

/**
 * POST /api/connect/v1/actions/{name}   body: { "input": { ... } }
 *
 * Sync actions answer `200 { output }`; async ones `202 { operation }` and are polled at
 * `GET /operations/{id}`. `Idempotency-Key` makes a retried POST run once.
 */
export const POST = tokenRoute<{ name: string }>({ route: "/actions/{name}", idempotent: true }, async (c) => {
  const action = findAction(c.params.name);
  if (!action) throw err.notFound("Action");
  c.audit(action.name);
  requireScopes(c.grant, action.scopes);

  const { input } = c.parse(z.strictObject({ input: action.input }), await c.json());
  const call = { grant: c.grant, requestId: c.requestId, ignoreUnknown: c.ignoreUnknown };

  if (!action.async) {
    const output = await action.handler(call, input);
    if (process.env.NODE_ENV !== "production") {
      const check = action.output.safeParse(output);
      if (!check.success) console.error(`[connector] the output of ${action.name} does not match its declared schema:`, JSON.stringify(check.error.issues).slice(0, 500));
    }
    return ok({ output });
  }

  const accepted = await action.accept(call, input);
  const op = await createOperation(c.grant, action.name, input as Record<string, unknown>, { state: accepted.state, creditsReserved: accepted.creditsReserved, requestId: c.requestId });
  deferTask(() => runOperation(op._id));
  return ok({ operation: operationWire(op) }, 202, { Location: operationWire(op).pollUrl });
});
