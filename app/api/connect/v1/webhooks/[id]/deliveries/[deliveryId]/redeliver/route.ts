import { err } from "@/lib/connector/errors";
import { redeliver } from "@/lib/connector/events/dispatcher";
import { ok, tokenRoute } from "@/lib/connector/http";
import { deliveryWire, loadWebhook } from "@/lib/connector/webhooks/store";
import { getCollections } from "@/lib/db/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds: a redelivery is sent inside the request and may wait for the endpoint for up to 10 seconds. */
export const maxDuration = 30;

/** POST /api/connect/v1/webhooks/{id}/deliveries/{deliveryId}/redeliver: sends that event to the endpoint again, now. */
export const POST = tokenRoute<{ id: string; deliveryId: string }>({ route: "/webhooks/{id}/deliveries/{deliveryId}/redeliver", scopes: ["slate:webhooks:manage"] }, async (c) => {
  const hook = await loadWebhook(c.grant.grantId, c.params.id);
  if (hook.status !== "active") throw err.conflict("The endpoint is disabled. Re-enable it (PATCH status: active) before redelivering.");
  const db = await getCollections();
  const delivery = await db.connectorDeliveries.findOne({ _id: c.params.deliveryId, webhookId: hook._id });
  if (!delivery) throw err.notFound("Delivery");
  return ok(deliveryWire(await redeliver(delivery)));
});
