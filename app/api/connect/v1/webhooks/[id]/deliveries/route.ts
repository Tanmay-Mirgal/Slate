import { z } from "zod";
import { decodeCursor, encodeCursor } from "@/lib/connector/data";
import { ok, tokenRoute } from "@/lib/connector/http";
import { paginationQuery } from "@/lib/connector/registry/schema";
import { deliveryWire, loadWebhook } from "@/lib/connector/webhooks/store";
import { getCollections } from "@/lib/db/mongo";
import type { Filter } from "mongodb";
import type { ConnectorDeliveryDoc } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connect/v1/webhooks/{id}/deliveries: the delivery log of an endpoint, newest first. */
export const GET = tokenRoute<{ id: string }>({ route: "/webhooks/{id}/deliveries", scopes: ["slate:webhooks:manage"] }, async (c) => {
  const hook = await loadWebhook(c.grant.grantId, c.params.id);
  const q = c.parse(z.strictObject({ ...paginationQuery, status: z.enum(["pending", "succeeded", "failed"]).optional() }), Object.fromEntries(c.url.searchParams));
  const cursor = decodeCursor(q.cursor, z.object({ t: z.number(), id: z.string() }));
  const filter: Filter<ConnectorDeliveryDoc> = { webhookId: hook._id, ...(q.status ? { status: q.status } : {}) };
  if (cursor) filter.$or = [{ createdAt: { $lt: cursor.t } }, { createdAt: cursor.t, _id: { $lt: cursor.id } }];
  const db = await getCollections();
  const rows = await db.connectorDeliveries
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1)
    .toArray();
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return ok({ items: page.map(deliveryWire), nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.createdAt, id: last._id }) : null });
});
