import { getCollections } from "@/lib/db/mongo";
import { allowPrivateWebhooks } from "../config";
import type { ConnectorDeliveryDoc, ConnectorWebhookDoc } from "@/lib/db/types";
import { err, type ErrorDetail } from "../errors";
import { EVENT_DEFINITIONS } from "../events/definitions";
import { iso } from "../data";
import type { UrlRules } from "./ssrf";

export const urlRules = (): UrlRules => ({ requireHttps: process.env.NODE_ENV === "production", allowPrivate: allowPrivateWebhooks() });

const KNOWN_TYPES = EVENT_DEFINITIONS.map((e) => e.type) as string[];

/** `board.approved`, or `board.*` for everything below `board.`. */
export const matchesEvent = (patterns: readonly string[], type: string): boolean => patterns.some((p) => p === type || (p.endsWith(".*") && type.startsWith(p.slice(0, -1))));

/** Subscriptions must name something that exists, so a typo is an error now rather than silence later. */
export function patternProblems(patterns: readonly string[]): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  patterns.forEach((p, i) => {
    const known = KNOWN_TYPES.includes(p) || (/^[a-z_]+(\.[a-z_]+)*\.\*$/.test(p) && KNOWN_TYPES.some((t) => t.startsWith(p.slice(0, -1))));
    if (!known) problems.push({ path: `events.${i}`, message: `"${p}" is not an event type or a prefix pattern like board.* (see the manifest)` });
  });
  return problems;
}

export function webhookWire(w: ConnectorWebhookDoc) {
  return {
    id: w._id,
    url: w.url,
    events: w.events,
    ...(w.description ? { description: w.description } : {}),
    status: w.status,
    ...(w.disabledReason ? { disabledReason: w.disabledReason } : {}),
    createdAt: iso(w.createdAt),
    ...(w.lastDeliveryAt ? { lastDeliveryAt: iso(w.lastDeliveryAt) } : {}),
    ...(w.lastDeliveryStatus ? { lastDeliveryStatus: w.lastDeliveryStatus } : {}),
  };
}

export function deliveryWire(d: ConnectorDeliveryDoc) {
  return {
    id: d._id,
    eventId: `evt_${d.eventId}`,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    ...(d.status === "pending" ? { nextAttemptAt: iso(d.nextAttemptAt) } : {}),
    ...(d.lastStatusCode !== undefined ? { lastStatusCode: d.lastStatusCode } : {}),
    ...(d.lastBody ? { lastBody: d.lastBody } : {}),
    ...(d.lastError ? { lastError: d.lastError } : {}),
    createdAt: iso(d.createdAt),
  };
}

/** The endpoint `id` if this connection registered it; anything else is "not found". */
export async function loadWebhook(grantId: string, id: string): Promise<ConnectorWebhookDoc> {
  const c = await getCollections();
  const hook = typeof id === "string" && id.length <= 80 ? await c.connectorWebhooks.findOne({ _id: id, grantId }) : null;
  if (!hook) throw err.notFound("Webhook");
  return hook;
}
