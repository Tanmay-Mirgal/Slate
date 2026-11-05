import { getCollections } from "@/lib/db/mongo";
import { TTL_MS } from "./config";
import { canonicalJson, sha256Hex } from "./crypto";
import { err } from "./errors";

export const MAX_KEY_LENGTH = 128;

/** A key is opaque to us; it only has to be a sane printable string. */
export function parseIdempotencyKey(raw: string | null): string | null {
  if (raw === null) return null;
  const key = raw.trim();
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw err.validation(`Idempotency-Key must be 1-${MAX_KEY_LENGTH} printable characters`);
  }
  return key;
}

/** What "the same request" means: same endpoint, same body (key order and whitespace do not matter). */
export const requestFingerprint = (route: string, body: unknown): string => sha256Hex(`${route}\n${canonicalJson(body ?? null)}`);

export type IdempotencyStart =
  | { kind: "fresh" }
  | { kind: "replay"; status: number; body: string }
  | { kind: "conflict" }
  | { kind: "in_progress" };

/** A first attempt that crashed leaves its row behind; after this long a retry may take it over. */
const STALE_MS = 2 * 60_000;

const idOf = (grantId: string, key: string) => `${grantId}:${key}`;

/**
 * Claims `(grantId, key)`. A concurrent duplicate loses the insert race and is told to retry shortly; the
 * same key with a different body is rejected; a finished request is replayed from the stored response.
 */
export async function beginIdempotent(grantId: string, key: string, fingerprint: string): Promise<IdempotencyStart> {
  const c = await getCollections();
  const _id = idOf(grantId, key);
  const now = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await c.connectorIdempotency.insertOne({ _id, requestHash: fingerprint, state: "in_progress", createdAt: now, expireAt: new Date(now + TTL_MS.idempotency) });
      return { kind: "fresh" };
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    }
    const existing = await c.connectorIdempotency.findOne({ _id });
    if (!existing) continue; // expired between the insert and the read: try again
    if (existing.requestHash !== fingerprint) return { kind: "conflict" };
    if (existing.state === "done" && existing.status !== undefined && existing.body !== undefined) return { kind: "replay", status: existing.status, body: existing.body };
    if (now - existing.createdAt > STALE_MS) {
      await c.connectorIdempotency.deleteOne({ _id, state: "in_progress", createdAt: existing.createdAt });
      continue;
    }
    return { kind: "in_progress" };
  }
  return { kind: "in_progress" };
}

export async function finishIdempotent(grantId: string, key: string, status: number, body: string): Promise<void> {
  const c = await getCollections();
  await c.connectorIdempotency.updateOne({ _id: idOf(grantId, key) }, { $set: { state: "done", status, body } });
}

/** A failed attempt is forgotten so that the caller can retry with the same key. */
export async function abandonIdempotent(grantId: string, key: string): Promise<void> {
  const c = await getCollections();
  await c.connectorIdempotency.deleteOne({ _id: idOf(grantId, key), state: "in_progress" });
}
