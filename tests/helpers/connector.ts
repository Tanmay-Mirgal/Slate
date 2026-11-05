import { getCollections, newDocId } from "@/lib/db/mongo";
import type { Id } from "@/lib/db/types";
import { TOKEN_PREFIX, TTL_MS } from "@/lib/connector/config";
import { hashToken, randomToken } from "@/lib/connector/crypto";
import type { Scope } from "@/lib/connector/scopes";

/** The Hub as the tests configure it. */
export const HUB = {
  clientId: "hub_test_client",
  clientSecret: "hub-test-secret-0123456789abcdefghijklmnop",
  redirectUri: "https://hub.example.com/oauth/callback/slate",
  pepper: "test-pepper-0123456789abcdefghijklmnopqrstuvwxyz",
  encryptionKey: "11".repeat(32),
  name: "Test Hub",
};

const KEYS = [
  "CONNECTOR_ENABLED",
  "CONNECTOR_HUB_NAME",
  "CONNECTOR_HUB_CLIENT_ID",
  "CONNECTOR_HUB_CLIENT_SECRET",
  "CONNECTOR_HUB_REDIRECT_URIS",
  "CONNECTOR_TOKEN_PEPPER",
  "CONNECTOR_ENCRYPTION_KEY",
  "CONNECTOR_ENCRYPTION_KEY_PREVIOUS",
  "CONNECTOR_DISPATCHER",
  "CONNECTOR_BASE_URL",
] as const;

export function enableConnector(extra: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  Object.assign(process.env, {
    CONNECTOR_ENABLED: "true",
    CONNECTOR_HUB_NAME: HUB.name,
    CONNECTOR_HUB_CLIENT_ID: HUB.clientId,
    CONNECTOR_HUB_CLIENT_SECRET: HUB.clientSecret,
    CONNECTOR_HUB_REDIRECT_URIS: HUB.redirectUri,
    CONNECTOR_TOKEN_PEPPER: HUB.pepper,
    CONNECTOR_ENCRYPTION_KEY: HUB.encryptionKey,
    CONNECTOR_BASE_URL: "https://slate.test",
    ...extra,
  });
}

export function disableConnector() {
  for (const k of KEYS) delete process.env[k];
}

export interface TestGrant {
  grantId: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  workspaceId: Id<"workspaces">;
}

/** Inserts a grant the way the token endpoint would (only HMACs stored) and returns the raw tokens. */
export async function makeGrant(opts: {
  userId: string;
  workspaceId: Id<"workspaces">;
  scopes: readonly Scope[];
  clientId?: string;
  revoked?: boolean;
  accessExpired?: boolean;
  lastUsedAt?: number;
}): Promise<TestGrant> {
  const c = await getCollections();
  const now = Date.now();
  const accessToken = randomToken(TOKEN_PREFIX.access);
  const refreshToken = randomToken(TOKEN_PREFIX.refresh);
  const grantId = newDocId();
  await c.connectorGrants.insertOne({
    _id: grantId,
    clientId: opts.clientId ?? HUB.clientId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    scopes: [...opts.scopes],
    accessHash: hashToken(accessToken),
    accessExpiresAt: opts.accessExpired ? now - 1000 : now + TTL_MS.access,
    refreshHash: hashToken(refreshToken),
    refreshFamilyId: grantId,
    refreshExpiresAt: now + TTL_MS.refresh,
    createdAt: now,
    ...(opts.lastUsedAt !== undefined ? { lastUsedAt: opts.lastUsedAt } : {}),
    ...(opts.revoked ? { revokedAt: now } : {}),
  });
  return { grantId, accessToken, refreshToken, userId: opts.userId, workspaceId: opts.workspaceId };
}

export const bearer = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${token}`, ...extra });

export const ORIGIN = "https://slate.test";

/** A request to the connector API, as the route handlers receive it. */
export function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; rawBody?: string } = {}): Request {
  const hasBody = init.body !== undefined || init.rawBody !== undefined;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    ...(hasBody ? { body: init.rawBody ?? JSON.stringify(init.body) } : {}),
  });
}

/** The users `setup()` creates memberships for, as rows in `users` (so nothing tries to reach Clerk). */
export async function seedUsers() {
  const { upsertUser } = await import("@/lib/server/users");
  const people = [
    ["user_owner", "owner@example.com", "Owner", "One"],
    ["user_editor", "editor@example.com", "Edie", "Editor"],
    ["user_viewer", "viewer@example.com", "Vic", "Viewer"],
    ["user_stranger", "stranger@example.com", "Sam", "Stranger"],
  ] as const;
  for (const [id, email, first, last] of people) await upsertUser(id, { email, emails: [email], firstName: first, lastName: last, imageUrl: null });
}

export const basicAuth = (id = HUB.clientId, secret = HUB.clientSecret): string => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
