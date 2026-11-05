import { getCollections, newDocId } from "@/lib/db/mongo";
import type { ConnectorAuditDoc, Id } from "@/lib/db/types";
import { TTL_MS } from "./config";

export interface AuditEntry {
  grantId: string;
  clientId: string;
  workspaceId: Id<"workspaces">;
  userId: string;
  method: string;
  /** Route pattern or action name. Never a payload: audit rows must not hold board content or secrets. */
  route: string;
  status: number;
  requestId: string;
  durationMs: number;
}

/** Appends one row to the connector audit log (`via: "connector"`), kept for 90 days. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const c = await getCollections();
  const now = Date.now();
  await c.connectorAudit.insertOne({ _id: newDocId(), at: now, via: "connector", ...entry, expireAt: new Date(now + TTL_MS.audit) });
}

export async function recentAudit(workspaceId: Id<"workspaces">, limit = 20, grantId?: string): Promise<ConnectorAuditDoc[]> {
  const c = await getCollections();
  return await c.connectorAudit
    .find({ workspaceId, ...(grantId ? { grantId } : {}) })
    .sort({ at: -1 })
    .limit(Math.max(1, Math.min(100, limit)))
    .toArray();
}
