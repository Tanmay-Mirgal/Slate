import { z } from "zod";
import { LIMITS } from "@/lib/connector/config";
import { encryptSecret, newWebhookSecret } from "@/lib/connector/crypto";
import { decodeCursor, encodeCursor } from "@/lib/connector/data";
import { err } from "@/lib/connector/errors";
import { ok, tokenRoute } from "@/lib/connector/http";
import { paginationQuery } from "@/lib/connector/registry/schema";
import { webhookInputSchema } from "@/lib/connector/registry/standard";
import { resolveWebhookTarget, WebhookUrlError } from "@/lib/connector/webhooks/ssrf";
import { patternProblems, urlRules, webhookWire } from "@/lib/connector/webhooks/store";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { Filter } from "mongodb";
import type { ConnectorWebhookDoc } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["slate:webhooks:manage"] as const;

/**
 * POST /api/connect/v1/webhooks: registers an endpoint. The signing secret (whsec_...) is in this response and
 * nowhere else, ever: it is stored encrypted and only used to sign deliveries. Not idempotent-replayable for
 * exactly that reason (a replay would have to keep the secret in plain text).
 */
export const POST = tokenRoute({ route: "/webhooks", scopes: SCOPES }, async (c) => {
  const input = c.parse(webhookInputSchema, await c.json());
  const problems = patternProblems(input.events);
  if (problems.length > 0) throw err.validation("Some events are not recognised", problems);

  try {
    await resolveWebhookTarget(input.url, urlRules());
  } catch (e) {
    if (e instanceof WebhookUrlError) throw err.validation(e.message, [{ path: "url", message: e.message }]);
    throw e;
  }

  const db = await getCollections();
  if ((await db.connectorWebhooks.countDocuments({ grantId: c.grant.grantId }, { limit: LIMITS.webhookMaxEndpoints })) >= LIMITS.webhookMaxEndpoints) {
    throw err.conflict(`A connection can have at most ${LIMITS.webhookMaxEndpoints} webhook endpoints. Delete one first.`);
  }

  const now = Date.now();
  const id = newDocId();
  const secret = newWebhookSecret();
  const doc: ConnectorWebhookDoc = {
    _id: id,
    grantId: c.grant.grantId,
    workspaceId: c.grant.workspaceId,
    url: input.url,
    events: [...new Set(input.events)],
    ...(input.description ? { description: input.description } : {}),
    secretEnc: encryptSecret(secret, id),
    status: "active",
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.connectorWebhooks.insertOne(doc);
  return ok({ ...webhookWire(doc), secret }, 201);
});

/** GET /api/connect/v1/webhooks: this connection's endpoints. */
export const GET = tokenRoute({ route: "/webhooks", scopes: SCOPES }, async (c) => {
  const q = c.parse(z.strictObject(paginationQuery), Object.fromEntries(c.url.searchParams));
  const cursor = decodeCursor(q.cursor, z.object({ t: z.number(), id: z.string() }));
  const filter: Filter<ConnectorWebhookDoc> = { grantId: c.grant.grantId };
  if (cursor) filter.$or = [{ createdAt: { $gt: cursor.t } }, { createdAt: cursor.t, _id: { $gt: cursor.id } }];
  const db = await getCollections();
  const rows = await db.connectorWebhooks
    .find(filter)
    .sort({ createdAt: 1, _id: 1 })
    .limit(q.limit + 1)
    .toArray();
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return ok({ items: page.map(webhookWire), nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.createdAt, id: last._id }) : null });
});
