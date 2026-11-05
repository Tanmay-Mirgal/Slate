import { err } from "@/lib/connector/errors";
import { ok, tokenRoute } from "@/lib/connector/http";
import { webhookPatchSchema } from "@/lib/connector/registry/standard";
import { resolveWebhookTarget, WebhookUrlError } from "@/lib/connector/webhooks/ssrf";
import { loadWebhook, patternProblems, urlRules, webhookWire } from "@/lib/connector/webhooks/store";
import { getCollections } from "@/lib/db/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["slate:webhooks:manage"] as const;
type P = { id: string };

/** GET /api/connect/v1/webhooks/{id}: status, why it was disabled (if it was), the last delivery. */
export const GET = tokenRoute<P>({ route: "/webhooks/{id}", scopes: SCOPES }, async (c) => ok(webhookWire(await loadWebhook(c.grant.grantId, c.params.id))));

/** PATCH: change the URL / events / description, or set status "active" to re-enable an endpoint that was disabled. */
export const PATCH = tokenRoute<P>({ route: "/webhooks/{id}", scopes: SCOPES }, async (c) => {
  const hook = await loadWebhook(c.grant.grantId, c.params.id);
  const input = c.parse(webhookPatchSchema, await c.json());
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  const unset: Record<string, ""> = {};

  if (input.events) {
    const problems = patternProblems(input.events);
    if (problems.length > 0) throw err.validation("Some events are not recognised", problems);
    set.events = [...new Set(input.events)];
  }
  if (input.url) {
    try {
      await resolveWebhookTarget(input.url, urlRules());
    } catch (e) {
      if (e instanceof WebhookUrlError) throw err.validation(e.message, [{ path: "url", message: e.message }]);
      throw e;
    }
    set.url = input.url;
  }
  if (input.description !== undefined) set.description = input.description;
  if (input.status === "active") {
    // a fresh start: the failure history that got it disabled no longer counts
    set.status = "active";
    set.consecutiveFailures = 0;
    Object.assign(unset, { disabledReason: "", disabledAt: "", firstFailureAt: "" });
  } else if (input.status === "disabled") {
    set.status = "disabled";
    set.disabledReason = "Disabled by the connected app";
    set.disabledAt = Date.now();
  }

  const db = await getCollections();
  const updated = await db.connectorWebhooks.findOneAndUpdate({ _id: hook._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { returnDocument: "after" });
  return ok(webhookWire(updated ?? hook));
});

/** DELETE: removes the endpoint and its delivery log. */
export const DELETE = tokenRoute<P>({ route: "/webhooks/{id}", scopes: SCOPES }, async (c) => {
  const hook = await loadWebhook(c.grant.grantId, c.params.id);
  const db = await getCollections();
  await Promise.all([db.connectorWebhooks.deleteOne({ _id: hook._id }), db.connectorDeliveries.deleteMany({ webhookId: hook._id })]);
  return { status: 204 };
});
