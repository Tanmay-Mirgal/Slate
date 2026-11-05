import { getCollections } from "@/lib/db/mongo";
import type { ConnectorGrantDoc, Id, Role } from "@/lib/db/types";
import { membershipOf } from "@/lib/server/access";
import type { Ctx } from "@/lib/server/fn";
import { ensureUser } from "@/lib/server/users";
import { connectorConfig, TOKEN_PREFIX } from "../config";
import { hashToken, safeEqual } from "../crypto";
import { deferTask } from "../defer";
import { err } from "../errors";
import { isScope, scopesForRole, type Scope } from "../scopes";

/** `lastUsedAt` is written at most this often per grant, so reads stay read-only almost always. */
const LAST_USED_EVERY_MS = 5 * 60_000;

/** Who is calling and what they may do, re-derived from the database on every request. */
export interface AuthedGrant {
  grantId: string;
  clientId: string;
  /** The Clerk user the connection acts as. */
  userId: string;
  workspaceId: Id<"workspaces">;
  /** What the user agreed to when connecting. */
  granted: ReadonlySet<Scope>;
  /** `granted` narrowed by the user's role right now. */
  effective: ReadonlySet<Scope>;
  role: Role;
  /** The context the existing server functions expect, so every access rule of the app applies as is. */
  ctx: Ctx;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** The server-function context of a connection: the consenting user, with the profile loaded lazily. */
export function ctxForUser(userId: string, defer: Ctx["defer"] = deferTask): Ctx {
  let profile: ReturnType<Ctx["profile"]> | null = null;
  return {
    userId,
    profile: () => (profile ??= ensureUser(userId)),
    defer,
  };
}

/**
 * Turns a bearer token into an `AuthedGrant`:
 *   1. look the token's HMAC up (never the token itself); unknown / expired / revoked -> 401
 *   2. re-read the user's CURRENT membership of the pinned workspace; none -> 403
 *   3. effective scopes = what was granted ∩ what that role may do today
 */
export async function authenticate(req: Request): Promise<AuthedGrant> {
  const token = bearerToken(req);
  if (!token || !token.startsWith(TOKEN_PREFIX.access)) throw err.unauthorized();

  const config = connectorConfig();
  const hash = hashToken(token, config.tokenPepper);
  const c = await getCollections();
  const grant = await c.connectorGrants.findOne({ accessHash: hash });
  const now = Date.now();
  if (!grant || !safeEqual(grant.accessHash, hash) || grant.revokedAt !== undefined || grant.accessExpiresAt <= now || grant.clientId !== config.clientId) {
    throw err.unauthorized();
  }

  const membership = await membershipOf(grant.workspaceId, grant.userId);
  if (!membership) throw err.forbidden("The user who connected this app is no longer a member of the workspace");

  if (grant.lastUsedAt === undefined || now - grant.lastUsedAt > LAST_USED_EVERY_MS) {
    // not worth delaying the response for; a lost write only means the timestamp is a bit older
    deferTask(async () => {
      await c.connectorGrants.updateOne({ _id: grant._id, $or: [{ lastUsedAt: { $exists: false } }, { lastUsedAt: { $lt: now - LAST_USED_EVERY_MS } }] }, { $set: { lastUsedAt: now } });
    });
  }

  return toAuthed(grant, membership.role);
}

/** The caller a grant stands for, given the role its user holds right now. */
export function toAuthed(grant: ConnectorGrantDoc, role: Role): AuthedGrant {
  const granted = new Set(grant.scopes.filter(isScope));
  const allowedByRole = new Set(scopesForRole(role));
  return {
    grantId: grant._id,
    clientId: grant.clientId,
    userId: grant.userId,
    workspaceId: grant.workspaceId,
    granted,
    effective: new Set([...granted].filter((s) => allowedByRole.has(s))),
    role,
    ctx: ctxForUser(grant.userId),
  };
}

/**
 * The same, for work that runs after the request that started it (background operations): looked up by grant id
 * instead of by token, with the same checks. Null when the grant was revoked or its user left the workspace.
 */
export async function authedFromGrantId(grantId: string): Promise<AuthedGrant | null> {
  const c = await getCollections();
  const grant = await c.connectorGrants.findOne({ _id: grantId });
  if (!grant || grant.revokedAt !== undefined) return null;
  const membership = await membershipOf(grant.workspaceId, grant.userId);
  return membership ? toAuthed(grant, membership.role) : null;
}

/**
 * Throws unless the connection may use every scope in `needed`: `insufficient_scope` when it was never granted
 * (the app must ask the user again), `forbidden` when it was granted but the user's role no longer allows it.
 */
export function requireScopes(grant: AuthedGrant, needed: readonly Scope[]): void {
  const missing = needed.filter((s) => !grant.granted.has(s));
  if (missing.length > 0) throw err.insufficientScope(missing);
  if (needed.some((s) => !grant.effective.has(s))) {
    throw err.forbidden(`Your role in this workspace (${grant.role}) does not allow this`);
  }
}
