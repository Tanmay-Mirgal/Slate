import { randomUUID } from "node:crypto";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { ConnectorDeliveryDoc, ConnectorEventDoc, ConnectorWebhookDoc } from "@/lib/db/types";
import { authedFromGrantId, type AuthedGrant } from "../auth/verify";
import { connectorEnabled, TTL_MS } from "../config";
import { decryptSecret, signWebhookBody } from "../crypto";
import { reapIfStale, runOperation } from "../operations";
import { sendJson, type SendResult } from "../webhooks/send";
import { resolveWebhookTarget, WebhookUrlError } from "../webhooks/ssrf";
import { matchesEvent, urlRules } from "../webhooks/store";
import { DISABLE_AFTER_FAILURES, DISABLE_AFTER_MS, nextDelayMs } from "./backoff";
import { EVENT_DEFINITIONS } from "./definitions";
import { toEnvelope } from "./emit";

/**
 * Drains the outbox. One pass does three things, each safe to run from any number of dispatchers at once (every
 * step claims its work atomically):
 *   1. fan out - for each event nobody has processed, create one delivery per endpoint that should get it. The
 *      endpoint filter runs HERE, before anything is queued: subscribed to the type, grant alive, user still in
 *      the workspace, and the grant's scopes (narrowed by the user's role) allow reading the event.
 *   2. deliver - send every due delivery, sign it, record the outcome, schedule the retry or give up
 *   3. sweep   - start asynchronous operations whose request died before it could, fail the ones that stalled
 */

const LEASE_MS = 60_000;
const requiredScopes = new Map<string, readonly string[]>(EVENT_DEFINITIONS.map((e) => [e.type, e.scopes]));

const ignoreDuplicates = (e: unknown) => {
  const code = (e as { code?: number }).code;
  if (code !== 11000) throw e;
};

/* ------------------------------------------------------------------ 1. fan out */

export async function fanOut(batch = 100): Promise<number> {
  const c = await getCollections();
  const events = await c.connectorEvents.find({ pending: true }).sort({ _id: 1 }).limit(batch).toArray();
  const grants = new Map<string, AuthedGrant | null>();
  const aliveGrant = async (id: string) => {
    if (!grants.has(id)) grants.set(id, await authedFromGrantId(id));
    return grants.get(id) ?? null;
  };

  for (const ev of events) {
    const hooks = await c.connectorWebhooks.find({ workspaceId: ev.workspaceId, status: "active" }).toArray();
    const needed = requiredScopes.get(ev.type) ?? ["slate:boards:read"];
    const targets: ConnectorWebhookDoc[] = [];
    for (const hook of hooks) {
      if (!matchesEvent(hook.events, ev.type)) continue;
      const grant = await aliveGrant(hook.grantId);
      if (grant && needed.every((s) => grant.effective.has(s as never))) targets.push(hook);
    }
    const now = Date.now();
    if (targets.length > 0) {
      await c.connectorDeliveries
        .insertMany(
          targets.map((h) => ({
            _id: newDocId(),
            eventId: ev._id,
            webhookId: h._id,
            grantId: h.grantId,
            workspaceId: ev.workspaceId,
            eventType: ev.type,
            deliveryUuid: randomUUID(),
            status: "pending" as const,
            attempts: 0,
            nextAttemptAt: now,
            createdAt: now,
            expireAt: new Date(now + TTL_MS.events),
          })),
          { ordered: false }
        )
        .catch(ignoreDuplicates); // another dispatcher got here first
    }
    await c.connectorEvents.updateOne({ _id: ev._id, pending: true }, { $unset: { pending: "" }, $set: { fannedOutAt: now } });
  }
  return events.length;
}

/* ------------------------------------------------------------------ 2. deliver */

async function disableEndpoint(hook: ConnectorWebhookDoc, reason: string): Promise<void> {
  const c = await getCollections();
  const now = Date.now();
  await c.connectorWebhooks.updateOne({ _id: hook._id }, { $set: { status: "disabled", disabledReason: reason, disabledAt: now, updatedAt: now } });
  await c.connectorDeliveries.updateMany({ webhookId: hook._id, status: "pending" }, { $set: { status: "failed", lastError: `Endpoint disabled: ${reason}` }, $unset: { leaseUntil: "" } });
}

/** Sends one delivery now and records what happened. Never throws. */
export async function attemptDelivery(delivery: ConnectorDeliveryDoc): Promise<ConnectorDeliveryDoc> {
  const c = await getCollections();
  const finish = async (patch: Partial<ConnectorDeliveryDoc>, unset: Record<string, ""> = { leaseUntil: "" }) => {
    await c.connectorDeliveries.updateOne({ _id: delivery._id }, { $set: patch, $unset: unset });
    return { ...delivery, ...patch };
  };
  try {
    const hook = await c.connectorWebhooks.findOne({ _id: delivery.webhookId });
    const event: ConnectorEventDoc | null = await c.connectorEvents.findOne({ _id: delivery.eventId });
    if (!hook || hook.status !== "active") return await finish({ status: "failed", lastError: "The endpoint was deleted or disabled" });
    if (!event) return await finish({ status: "failed", lastError: "The event is no longer available" });

    const body = JSON.stringify(toEnvelope(event));
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      "Content-Type": "application/json",
      "X-CP-Event": event.type,
      "X-CP-Delivery": delivery.deliveryUuid,
      "X-CP-Timestamp": String(timestamp),
      "X-CP-Signature": signWebhookBody(decryptSecret(hook.secretEnc, hook._id), timestamp, body),
      "User-Agent": "Slate-Connector/1.0",
    };

    let result: SendResult;
    try {
      // looked up again for every attempt: a name that was public at registration may point inside now
      result = await sendJson(await resolveWebhookTarget(hook.url, urlRules()), headers, body);
    } catch (e) {
      result = { ok: false, durationMs: 0, error: e instanceof WebhookUrlError ? `Blocked: ${e.message}` : "The delivery could not be sent" };
    }

    const now = Date.now();
    const attempts = delivery.attempts + 1;
    const record = { attempts, lastAttemptAt: now, ...(result.status !== undefined ? { lastStatusCode: result.status } : {}), ...(result.body ? { lastBody: result.body } : {}), ...(result.error ? { lastError: result.error } : {}) };

    if (result.ok) {
      await c.connectorWebhooks.updateOne({ _id: hook._id }, { $set: { consecutiveFailures: 0, lastDeliveryAt: now, lastDeliveryStatus: "succeeded" }, $unset: { firstFailureAt: "" } });
      return await finish({ ...record, status: "succeeded" }, { leaseUntil: "", lastError: "" });
    }

    const updated = await c.connectorWebhooks.findOneAndUpdate(
      { _id: hook._id },
      { $inc: { consecutiveFailures: 1 }, $set: { lastDeliveryAt: now, lastDeliveryStatus: "failed" }, $min: { firstFailureAt: now } },
      { returnDocument: "after" }
    );
    if (result.status === 410) {
      await disableEndpoint(hook, "The endpoint answered 410 Gone");
      return await finish({ ...record, status: "failed" });
    }
    if (updated && updated.consecutiveFailures >= DISABLE_AFTER_FAILURES) {
      await disableEndpoint(updated, `${DISABLE_AFTER_FAILURES} deliveries in a row failed`);
      return await finish({ ...record, status: "failed" });
    }
    if (updated?.firstFailureAt !== undefined && now - updated.firstFailureAt >= DISABLE_AFTER_MS) {
      await disableEndpoint(updated, "Every delivery has failed for 3 days");
      return await finish({ ...record, status: "failed" });
    }
    const delay = nextDelayMs(attempts);
    if (delay === null) return await finish({ ...record, status: "failed" });
    return await finish({ ...record, status: "pending", nextAttemptAt: now + delay });
  } catch (e) {
    console.error("[connector] delivery attempt failed:", e instanceof Error ? e.message : e);
    return await finish({ status: "pending", nextAttemptAt: Date.now() + 60_000, lastError: "Internal error while delivering" }).catch(() => delivery);
  }
}

export async function deliverDue(batch = 25): Promise<number> {
  const c = await getCollections();
  let done = 0;
  for (; done < batch; done++) {
    const now = Date.now();
    const claimed = await c.connectorDeliveries.findOneAndUpdate(
      { status: "pending", nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseUntil: now + LEASE_MS } },
      { sort: { nextAttemptAt: 1 }, returnDocument: "after" }
    );
    if (!claimed) break;
    await attemptDelivery(claimed);
  }
  return done;
}

/** Manual replay (`POST .../redeliver`): a fresh delivery id and attempt count, sent right away. */
export async function redeliver(delivery: ConnectorDeliveryDoc): Promise<ConnectorDeliveryDoc> {
  const c = await getCollections();
  const now = Date.now();
  const reset = { status: "pending" as const, attempts: 0, nextAttemptAt: now, leaseUntil: now + LEASE_MS, deliveryUuid: randomUUID() };
  await c.connectorDeliveries.updateOne({ _id: delivery._id }, { $set: reset, $unset: { lastError: "", lastBody: "", lastStatusCode: "" } });
  return await attemptDelivery({ ...delivery, ...reset, lastError: undefined, lastBody: undefined, lastStatusCode: undefined });
}

/* ------------------------------------------------------------------ 3. sweep */

export async function sweepOperations(): Promise<number> {
  const c = await getCollections();
  const now = Date.now();
  const orphaned = await c.connectorOperations.find({ status: "pending", createdAt: { $lt: now - 20_000 } }).limit(10).toArray();
  for (const op of orphaned) await runOperation(op._id);
  const stalled = await c.connectorOperations.find({ status: "running", leaseUntil: { $lt: now } }).limit(10).toArray();
  for (const op of stalled) await reapIfStale(op);
  return orphaned.length + stalled.length;
}

/* ------------------------------------------------------------------ the loop */

export async function runDispatcherOnce(): Promise<{ fanned: number; delivered: number; swept: number }> {
  if (!connectorEnabled()) return { fanned: 0, delivered: 0, swept: 0 };
  const fanned = await fanOut();
  const delivered = await deliverDue();
  const swept = await sweepOperations();
  return { fanned, delivered, swept };
}

export function startDispatcher(opts: { intervalMs?: number; log?: Pick<Console, "info" | "error"> } = {}): { stop(): Promise<void> } {
  const log = opts.log ?? console;
  let running: Promise<unknown> = Promise.resolve();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    running = running
      .then(() => runDispatcherOnce())
      .catch((e) => log.error("[connector] dispatcher pass failed:", e instanceof Error ? e.message : e));
  };
  const timer = setInterval(tick, opts.intervalMs ?? 2_000);
  tick();
  log.info("[connector] dispatcher started");
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
