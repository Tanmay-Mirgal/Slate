import { refundAiCredit } from "@/lib/billing/ai-credits";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { ConnectorOperationDoc } from "@/lib/db/types";
import { authedFromGrantId, type AuthedGrant } from "./auth/verify";
import { connectorConfig, TTL_MS } from "./config";
import { err, normalizeError } from "./errors";
import { iso } from "./data";
import { registry } from "./registry";
import type { AsyncActionDef } from "./registry/define";

/**
 * Asynchronous actions. The request that starts one answers `202` right away; the work runs after the response
 * (and, if that instance dies, is picked up or failed by the dispatcher / the next poll), and the caller polls
 * `GET /operations/{id}`. Operations belong to the connection that started them and are kept for 7 days.
 */

/** A worker holds an operation for this long and renews the hold while it works. */
export const LEASE_MS = 150_000;
const HEARTBEAT_MS = 30_000;
/** An accepted operation nobody started within this time is given up on. */
const START_TIMEOUT_MS = 2 * 60_000;

export const pollUrl = (id: string) => `${connectorConfig().baseUrl}/api/connect/v1/operations/${id}`;

export async function createOperation(
  grant: AuthedGrant,
  action: string,
  input: Record<string, unknown>,
  extra: { state?: Record<string, unknown>; creditsReserved?: number; requestId: string }
): Promise<ConnectorOperationDoc> {
  const c = await getCollections();
  const now = Date.now();
  const op: ConnectorOperationDoc = {
    _id: `op_${newDocId()}`,
    grantId: grant.grantId,
    workspaceId: grant.workspaceId,
    action,
    status: "pending",
    input,
    ...(extra.state ? { state: extra.state } : {}),
    requestId: extra.requestId,
    ...(extra.creditsReserved ? { creditsReserved: extra.creditsReserved } : {}),
    createdAt: now,
    expireAt: new Date(now + TTL_MS.operations),
  };
  await c.connectorOperations.insertOne(op);
  return op;
}

/** What `GET /operations/{id}` returns (and the `202` body, with `status: "pending"`). */
export function operationWire(op: ConnectorOperationDoc) {
  return {
    id: op._id,
    action: op.action,
    status: op.status,
    ...(op.output ? { output: op.output } : {}),
    ...(op.error ? { error: op.error } : {}),
    createdAt: iso(op.createdAt),
    ...(op.finishedAt ? { finishedAt: iso(op.finishedAt) } : {}),
    pollUrl: pollUrl(op._id),
  };
}

/** The operation `id` if it belongs to this connection; anything else is "not found", never "forbidden". */
export async function loadOperation(grant: AuthedGrant, id: string): Promise<ConnectorOperationDoc> {
  const c = await getCollections();
  const op = typeof id === "string" && id.length <= 80 ? await c.connectorOperations.findOne({ _id: id, grantId: grant.grantId }) : null;
  if (!op) throw err.notFound("Operation");
  return op;
}

/** Hands back the AI credits an operation reserved, once, however many times this is called. */
async function refundOnce(op: ConnectorOperationDoc, userId: string): Promise<void> {
  if (!op.creditsReserved) return;
  const c = await getCollections();
  const claimed = await c.connectorOperations.findOneAndUpdate({ _id: op._id, creditsRefunded: { $ne: true } }, { $set: { creditsRefunded: true } });
  if (claimed) await refundAiCredit(userId, op.creditsReserved);
}

export async function failOperation(op: ConnectorOperationDoc, userId: string, error: { code: string; message: string; retryable: boolean }): Promise<void> {
  const c = await getCollections();
  await c.connectorOperations.updateOne({ _id: op._id, status: { $in: ["pending", "running"] } }, { $set: { status: "failed", error, finishedAt: Date.now() }, $unset: { leaseUntil: "" } });
  await refundOnce(op, userId);
}

/**
 * Runs an accepted operation to a terminal state. Safe to call from several places (the request's `after`, the
 * dispatcher, a poll): only the caller that wins the claim does the work.
 */
export async function runOperation(operationId: string): Promise<void> {
  const c = await getCollections();
  const now = Date.now();
  const op = await c.connectorOperations.findOneAndUpdate({ _id: operationId, status: "pending" }, { $set: { status: "running", startedAt: now, leaseUntil: now + LEASE_MS } }, { returnDocument: "after" });
  if (!op) return;

  const grant = await authedFromGrantId(op.grantId);
  const def = registry.actions.find((a): a is AsyncActionDef => a.async && a.name === op.action);
  if (!grant || !def) {
    await failOperation(op, grant?.userId ?? "", { code: grant ? "internal" : "forbidden", message: grant ? "This action is no longer available" : "The connection was revoked before the operation started", retryable: false });
    return;
  }

  const heartbeat = setInterval(() => {
    void c.connectorOperations.updateOne({ _id: op._id, status: "running" }, { $set: { leaseUntil: Date.now() + LEASE_MS } }).catch(() => undefined);
  }, HEARTBEAT_MS);
  try {
    const output = (await def.run({ grant, operationId: op._id, requestId: op.requestId ?? op._id }, op.input, op.state ?? {})) as Record<string, unknown>;
    await c.connectorOperations.updateOne({ _id: op._id, status: "running" }, { $set: { status: "succeeded", output, finishedAt: Date.now() }, $unset: { leaseUntil: "" } });
  } catch (e) {
    const ce = normalizeError(e);
    if (ce.status >= 500) console.error(`[connector] operation ${op._id} (${op.action}) failed:`, e instanceof Error ? `${e.name}: ${e.message}` : e);
    await failOperation(op, grant.userId, { code: ce.code, message: ce.message, retryable: ce.retryable });
    await def.onFailure?.({ grant, operationId: op._id, requestId: op.requestId ?? op._id }, op.input, op.state ?? {}, ce).catch((hookError) => console.error(`[connector] onFailure of ${op.action} failed:`, hookError instanceof Error ? hookError.message : hookError));
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * An operation whose worker died (lease expired) or that never started is failed, with its credits returned, the
 * next time anybody looks at it. This is what makes polling safe even when no dispatcher is running.
 */
export async function reapIfStale(op: ConnectorOperationDoc): Promise<ConnectorOperationDoc> {
  const now = Date.now();
  const stuck = (op.status === "running" && (op.leaseUntil ?? 0) < now) || (op.status === "pending" && now - op.createdAt > START_TIMEOUT_MS);
  if (!stuck) return op;
  const c = await getCollections();
  await failOperation(op, (await c.connectorGrants.findOne({ _id: op.grantId }))?.userId ?? "", { code: "upstream_failed", message: "The operation did not finish. Any AI credits it reserved were returned; you can try again.", retryable: true });
  return (await c.connectorOperations.findOne({ _id: op._id })) ?? op;
}
