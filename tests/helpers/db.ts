import { MongoMemoryServer } from "mongodb-memory-server";
import type { FnRef } from "@/lib/client/api";
import { closeMongo, getCollections, newDocId } from "@/lib/db/mongo";
import type { Role, SlateDoc } from "@/lib/db/types";
import { invoke, type Ctx } from "@/lib/server/fn";
import { lookup } from "@/lib/server/registry";
import { ensureUser } from "@/lib/server/users";

/** A real MongoDB (in memory) for the server tests: the same driver, queries and indexes as production. */
let server: MongoMemoryServer | null = null;

export async function startDb() {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB = "slate_test";
  await getCollections(); // connects and creates the indexes
}

export async function stopDb() {
  await closeMongo();
  await server?.stop();
  server = null;
}

/** Empties every collection (indexes stay) so each test starts from nothing. */
export async function resetDb() {
  const c = await getCollections();
  const names = (await c.db.listCollections().toArray()).map((x) => x.name);
  await Promise.all(names.filter((n) => !n.startsWith("system.")).map((n) => c.db.collection(n).deleteMany({})));
}

export interface TestUser {
  subject: string;
  email: string;
  name: string;
}

export const OWNER: TestUser = { subject: "user_owner", email: "owner@example.com", name: "Owner" };
export const EDITOR: TestUser = { subject: "user_editor", email: "editor@example.com", name: "Editor" };
export const VIEWER: TestUser = { subject: "user_viewer", email: "viewer@example.com", name: "Viewer" };
export const STRANGER: TestUser = { subject: "user_stranger", email: "stranger@example.com", name: "Stranger" };

type AnyRef<A, R> = FnRef<"query" | "mutation", A, R>;

/** Tasks the code under test scheduled with `ctx.defer` (what runs after the response in production). */
export class Deferred {
  private tasks: (() => Promise<unknown>)[] = [];
  push = (task: () => Promise<unknown>) => void this.tasks.push(task);
  get pending() {
    return this.tasks.length;
  }
  async flush() {
    const run = this.tasks;
    this.tasks = [];
    await Promise.all(run.map((t) => t()));
  }
}

export function ctxFor(user: TestUser | null, deferred = new Deferred()): Ctx {
  return {
    userId: user?.subject ?? null,
    // like production: the stored profile, created on first use (here from the test user instead of Clerk)
    profile: async () => {
      if (!user) return null;
      const [first, ...rest] = user.name.split(" ");
      return await ensureUser(user.subject, async () => ({ email: user.email, emails: [user.email], firstName: first || null, lastName: rest.join(" ") || null, imageUrl: null }));
    },
    defer: deferred.push,
  };
}

/** A caller: `as(OWNER).mutation(api.slates.create, {...})`, `as(null)` for an anonymous visitor. */
export function as(user: TestUser | null, deferred = new Deferred()) {
  const run = async <A, R>(ref: AnyRef<A, R>, args?: A): Promise<R> => {
    const fn = lookup(ref.name);
    if (!fn) throw new Error(`no such function: ${ref.name}`);
    return (await invoke(fn, ctxFor(user, deferred), args)) as R;
  };
  return { query: run, mutation: run, deferred };
}

/** Workspace "WS" owned by OWNER with an Editor and a Viewer, plus one board in it. */
export async function setup() {
  const c = await getCollections();
  const workspaceId = newDocId();
  await c.workspaces.insertOne({ _id: workspaceId, name: "WS", ownerId: OWNER.subject, createdAt: 1, updatedAt: 1 });
  for (const [u, role] of [
    [OWNER, "Admin"],
    [EDITOR, "Editor"],
    [VIEWER, "Viewer"],
  ] as [TestUser, Role][]) {
    await c.workspaceMembers.insertOne({ _id: newDocId(), workspaceId, userId: u.subject, role, addedAt: 1 });
  }
  const slateId = newDocId();
  const slate: SlateDoc = { _id: slateId, title: "Board", workspaceId, isArchived: false, createdAt: Date.now(), lastEdited: 1, thumbnailIcon: "1", linkAccess: "none", schemaVersion: 2, elementSeq: 0 };
  await c.slates.insertOne(slate);
  return { workspaceId, slateId };
}
