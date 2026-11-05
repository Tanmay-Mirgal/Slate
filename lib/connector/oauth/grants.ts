import { getCollections, newDocId } from "@/lib/db/mongo";
import type { ConnectorGrantDoc, Id } from "@/lib/db/types";
import { membershipOf } from "@/lib/server/access";
import { displayName } from "@/lib/server/profile";
import { ensureUser } from "@/lib/server/users";
import { connectorConfig, TOKEN_PREFIX, TTL_MS } from "../config";
import { hashToken, randomToken, verifyPkce } from "../crypto";
import { isScope, roleSatisfies, type Scope } from "../scopes";
import { OAuthError } from "./errors";

/**
 * Grants and their tokens. A grant is one user's consent for one app in one workspace; it holds the HMAC of the
 * current access token and of the current refresh token and nothing else. The raw tokens exist only in the
 * response that hands them out.
 */

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const newTokens = (): IssuedTokens => ({
  accessToken: randomToken(TOKEN_PREFIX.access),
  refreshToken: randomToken(TOKEN_PREFIX.refresh),
  expiresIn: TTL_MS.access / 1000,
});

/* ------------------------------------------------------------------ authorization codes */

export async function createAuthCode(input: { clientId: string; userId: string; workspaceId: Id<"workspaces">; scopes: readonly Scope[]; redirectUri: string; codeChallenge: string }): Promise<string> {
  const c = await getCollections();
  const code = randomToken("cp1c_slate_");
  const now = Date.now();
  await c.connectorCodes.insertOne({
    _id: hashToken(code),
    clientId: input.clientId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes: [...input.scopes],
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: now + TTL_MS.authCode,
    expireAt: new Date(now + TTL_MS.authCode + TTL_MS.usedCode),
  });
  return code;
}

/** Creates the grant and its first pair of tokens. */
export async function mintGrant(input: { clientId: string; userId: string; workspaceId: Id<"workspaces">; scopes: readonly Scope[] }): Promise<{ grant: ConnectorGrantDoc; tokens: IssuedTokens }> {
  const c = await getCollections();
  const now = Date.now();
  const tokens = newTokens();
  const id = newDocId();
  const grant: ConnectorGrantDoc = {
    _id: id,
    clientId: input.clientId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes: [...input.scopes],
    accessHash: hashToken(tokens.accessToken),
    accessExpiresAt: now + TTL_MS.access,
    refreshHash: hashToken(tokens.refreshToken),
    refreshFamilyId: id,
    refreshExpiresAt: now + TTL_MS.refresh,
    createdAt: now,
  };
  await c.connectorGrants.insertOne(grant);
  return { grant, tokens };
}

/**
 * Redeems an authorization code for a grant. Every failure is `invalid_grant`, and the code is burned by the
 * attempt. Presenting a code a second time revokes the grant that was minted from it (RFC 6749 §4.1.2).
 */
export async function exchangeAuthCode(input: { code: string; redirectUri: string; codeVerifier: string; clientId: string }): Promise<{ grant: ConnectorGrantDoc; tokens: IssuedTokens }> {
  const c = await getCollections();
  const now = Date.now();
  const id = hashToken(input.code);
  const bad = (why: string) => new OAuthError("invalid_grant", why);

  // atomically claim the code: exactly one caller gets the unused document
  const claimed = await c.connectorCodes.findOneAndUpdate({ _id: id, usedAt: { $exists: false } }, { $set: { usedAt: now, expireAt: new Date(now + TTL_MS.usedCode) } }, { returnDocument: "before" });
  if (!claimed) {
    // A second presentation. Flag the code first, then revoke what it already produced; the winner re-checks the
    // flag after it has recorded its grant, so whichever of the two gets there first, the grant does not survive.
    const earlier = await c.connectorCodes.findOneAndUpdate({ _id: id }, { $set: { reused: true } }, { returnDocument: "after" });
    if (earlier?.grantId) await revokeGrant(earlier.grantId, "authorization_code_reuse");
    throw bad("The authorization code is invalid, expired or was already used");
  }
  if (claimed.expiresAt <= now) throw bad("The authorization code has expired");
  if (claimed.clientId !== input.clientId) throw bad("The authorization code was issued to another client");
  if (claimed.redirectUri !== input.redirectUri) throw bad("redirect_uri does not match the authorization request");
  if (!verifyPkce(input.codeVerifier, claimed.codeChallenge)) throw bad("code_verifier does not match the code_challenge");

  // consent was given a moment ago, but the person's role could have changed in between
  const membership = await membershipOf(claimed.workspaceId, claimed.userId);
  const scopes = claimed.scopes.filter(isScope);
  if (!membership || !roleSatisfies(membership.role, scopes)) throw bad("The user no longer holds a role that allows these permissions");

  const minted = await mintGrant({ clientId: claimed.clientId, userId: claimed.userId, workspaceId: claimed.workspaceId, scopes });
  const recorded = await c.connectorCodes.findOneAndUpdate({ _id: id }, { $set: { grantId: minted.grant._id } }, { returnDocument: "after" });
  if (recorded?.reused) {
    // someone presented the code again while we were minting: that is a replay, so nothing from it may live
    await revokeGrant(minted.grant._id, "authorization_code_reuse");
    throw bad("The authorization code was used more than once");
  }
  return minted;
}

/* ------------------------------------------------------------------ refresh rotation */

/**
 * Trades a refresh token for a new pair. The old refresh token stops working at once and is remembered, so if
 * it is ever presented again (a stolen copy, or a client that lost the response) the whole grant is revoked:
 * nobody can tell the thief from the owner, so neither keeps access.
 */
export async function rotateRefreshToken(input: { refreshToken: string; clientId: string; scopes?: readonly Scope[] }): Promise<{ grant: ConnectorGrantDoc; tokens: IssuedTokens }> {
  const c = await getCollections();
  const now = Date.now();
  const oldHash = hashToken(input.refreshToken);
  const bad = (why = "The refresh token is invalid, expired or was already used") => new OAuthError("invalid_grant", why);
  if (!input.refreshToken.startsWith(TOKEN_PREFIX.refresh)) throw bad();

  const grant = await c.connectorGrants.findOne({ refreshHash: oldHash });
  if (!grant) {
    const used = await c.connectorUsedRefresh.findOne({ _id: oldHash });
    if (used) await revokeGrant(used.grantId, "refresh_token_reuse");
    throw bad();
  }
  if (grant.revokedAt !== undefined || grant.refreshExpiresAt <= now || grant.clientId !== input.clientId) throw bad();

  const membership = await membershipOf(grant.workspaceId, grant.userId);
  if (!membership) throw bad("The user is no longer a member of the workspace");
  if (input.scopes && !input.scopes.every((s) => grant.scopes.includes(s))) throw new OAuthError("invalid_scope", "A refresh can only narrow the granted scopes");

  const tokens = newTokens();
  const rotated = await c.connectorGrants.findOneAndUpdate(
    { _id: grant._id, refreshHash: oldHash, revokedAt: { $exists: false } },
    {
      $set: {
        accessHash: hashToken(tokens.accessToken),
        accessExpiresAt: now + TTL_MS.access,
        refreshHash: hashToken(tokens.refreshToken),
        refreshExpiresAt: now + TTL_MS.refresh,
        ...(input.scopes ? { scopes: [...input.scopes] } : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (!rotated) {
    // someone rotated this token between our read and our write: that is a second use
    await revokeGrant(grant._id, "refresh_token_reuse");
    throw bad();
  }
  await c.connectorUsedRefresh.updateOne({ _id: oldHash }, { $setOnInsert: { grantId: grant._id, expireAt: new Date(now + TTL_MS.refresh) } }, { upsert: true });
  return { grant: rotated, tokens };
}

/* ------------------------------------------------------------------ revocation */

/**
 * Ends a grant immediately (the next request with its token is a 401) and removes the webhook endpoints it
 * registered, so nothing keeps being delivered on behalf of a connection that no longer exists.
 */
export async function revokeGrant(grantId: string, reason: string): Promise<boolean> {
  const c = await getCollections();
  const res = await c.connectorGrants.updateOne({ _id: grantId, revokedAt: { $exists: false } }, { $set: { revokedAt: Date.now(), revokedReason: reason } });
  await Promise.all([c.connectorWebhooks.deleteMany({ grantId }), c.connectorDeliveries.deleteMany({ grantId })]);
  return res.modifiedCount === 1;
}

/** RFC 7009: revokes whichever grant owns this access or refresh token, if it belongs to `clientId`. Unknown tokens are ignored. */
export async function revokeByToken(token: string, clientId: string): Promise<void> {
  const c = await getCollections();
  const hash = hashToken(token);
  const grant = await c.connectorGrants.findOne({ $or: [{ accessHash: hash }, { refreshHash: hash }] });
  if (grant && grant.clientId === clientId) await revokeGrant(grant._id, "revoked_by_client");
}

/* ------------------------------------------------------------------ what the token response says about the grant */

export async function describeGrant(grant: ConnectorGrantDoc) {
  const c = await getCollections();
  const [workspace, user] = await Promise.all([c.workspaces.findOne({ _id: grant.workspaceId }), ensureUser(grant.userId)]);
  return {
    tenant: { id: grant.workspaceId, name: workspace?.name ?? "Workspace", kind: "workspace" as const },
    user: { id: grant.userId, email: user.email, name: displayName(user) },
  };
}

export async function tokenResponse(grant: ConnectorGrantDoc, tokens: IssuedTokens) {
  return {
    token_type: "Bearer" as const,
    access_token: tokens.accessToken,
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: grant.scopes.join(" "),
    ...(await describeGrant(grant)),
  };
}

/** Which Hub the grants of this deployment belong to (for display). */
export const hubName = (): string => connectorConfig().hubName;
