import { MongoError, type ClientSession } from "mongodb";
import { getCollections } from "@/lib/db/mongo";
import type { ConnectorEventDoc, ExternalRef, Id } from "@/lib/db/types";
import { connectorEnabled, PROTOCOL, SERVICE, TTL_MS } from "../config";
import { newUlid } from "../crypto";

export interface EventActor {
  id: string;
  name: string;
  kind: "user" | "system" | "connector";
}

export interface EmitInput {
  workspaceId: Id<"workspaces">;
  /** `board.approved` */
  type: string;
  boardId?: Id<"slates">;
  data: Record<string, unknown>;
  actor: EventActor;
  /** Correlation ids of the board's creator; echoed so the Hub can match the event to its workflow run. */
  externalRef?: ExternalRef;
  occurredAt?: number;
}

/** Does any app currently hold a live connection to this workspace? If not, nobody could ever read the event. */
export async function workspaceHasConnector(workspaceId: Id<"workspaces">, session?: ClientSession): Promise<boolean> {
  const c = await getCollections();
  const now = Date.now();
  return (await c.connectorGrants.countDocuments({ workspaceId, revokedAt: { $exists: false }, refreshExpiresAt: { $gt: now } }, { limit: 1, session })) > 0;
}

/**
 * Appends an event to the workspace's log, which doubles as the outbox the dispatcher drains. Pass the `session`
 * of `inOutbox` so the row commits with the change that caused it. Does nothing (and touches nothing) when the
 * connector is off or the workspace has no connection, so ordinary use of Slate pays no cost for it.
 */
export async function emitEvent(input: EmitInput, session?: ClientSession): Promise<string | null> {
  if (!connectorEnabled()) return null;
  if (!(await workspaceHasConnector(input.workspaceId, session))) return null;

  const c = await getCollections();
  // The counter row is created outside the transaction, so two first events cannot collide on its insert.
  await c.connectorCounters.updateOne({ _id: input.workspaceId }, { $setOnInsert: { seq: 0 } }, { upsert: true }).catch((e) => {
    if ((e as { code?: number }).code !== 11000) throw e;
  });
  // Incrementing the same row serialises concurrent writers, so cursor order is commit order.
  const counter = await c.connectorCounters.findOneAndUpdate({ _id: input.workspaceId }, { $inc: { seq: 1 } }, { returnDocument: "after", session });
  if (!counter) {
    // The row was created just now, after this transaction's snapshot began, so the transaction cannot see it.
    // Retrying starts a new snapshot, which does (the driver retries anything labelled transient).
    const retry = new MongoError("The event counter did not exist when the transaction began");
    retry.addErrorLabel("TransientTransactionError");
    throw retry;
  }
  const occurredAt = input.occurredAt ?? Date.now();
  const id = newUlid(occurredAt);
  await c.connectorEvents.insertOne(
    {
      _id: id,
      workspaceId: input.workspaceId,
      type: input.type,
      occurredAt,
      cursor: counter.seq,
      actor: input.actor,
      ...(input.externalRef && Object.keys(input.externalRef).length > 0 ? { externalRef: input.externalRef } : {}),
      data: input.data,
      ...(input.boardId ? { boardId: input.boardId } : {}),
      pending: true,
      expireAt: new Date(occurredAt + TTL_MS.events),
    },
    { session }
  );
  return id;
}

/** The body of a delivery and the item `GET /events` returns: CP1 section 5's envelope. */
export function toEnvelope(e: ConnectorEventDoc) {
  return {
    id: `evt_${e._id}`,
    type: e.type,
    apiVersion: PROTOCOL,
    service: SERVICE,
    occurredAt: new Date(e.occurredAt).toISOString(),
    tenantId: e.workspaceId,
    actor: e.actor,
    ...(e.externalRef ? { externalRef: e.externalRef } : {}),
    data: e.data,
  };
}
