import type { ClientSession, Db } from "mongodb";
import { getCollections } from "@/lib/db/mongo";
import { connectorEnabled } from "../config";

const support = new WeakMap<Db, Promise<boolean>>();

/** True when the database can run multi-document transactions: a replica set (Atlas always is) or a sharded cluster. */
export async function supportsTransactions(): Promise<boolean> {
  const c = await getCollections();
  let known = support.get(c.db);
  if (!known) {
    known = c.db
      .admin()
      .command({ hello: 1 })
      .then((h) => Boolean(h.setName) || h.msg === "isdbgrid")
      .catch(() => false);
    support.set(c.db, known);
  }
  return known;
}

/**
 * Runs `fn` so that the state change and the event row it causes commit together or not at all (the
 * transactional outbox). Every database call inside `fn` must pass the `session` it is given. The callback can
 * run more than once if the transaction is retried, so it must not have side effects outside the database.
 *
 * Where transactions do not exist (a standalone mongod: unit tests and a bare local database, never Atlas) `fn`
 * gets no session and simply runs: the caller writes the state first and the event right after, which can lose
 * the event if the process dies in between. That trade-off is documented in docs/CONNECTOR.md.
 */
export async function inOutbox<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!connectorEnabled() || !(await supportsTransactions())) return await fn(undefined);
  const c = await getCollections();
  const session = c.db.client.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}
