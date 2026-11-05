import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as revokeRoute } from "@/app/api/connect/v1/oauth/revoke/route";
import { POST as tokenRoute } from "@/app/api/connect/v1/oauth/token/route";
import { GET as meRoute } from "@/app/api/connect/v1/me/route";
import { pkceChallenge } from "@/lib/connector/crypto";
import { errorRedirect, redirectWith, validateAuthorizeRequest } from "@/lib/connector/oauth/authorize";
import { signConsent, verifyConsent } from "@/lib/connector/oauth/consent";
import { createAuthCode } from "@/lib/connector/oauth/grants";
import { ALL_SCOPES, type Scope } from "@/lib/connector/scopes";
import { api } from "@/lib/client/api";
import { getCollections, newDocId } from "@/lib/db/mongo";
import { basicAuth, bearer, disableConnector, enableConnector, HUB, req, seedUsers } from "./helpers/connector";
import { as, EDITOR, OWNER, resetDb, setup, startDb, stopDb, STRANGER, VIEWER } from "./helpers/db";

beforeAll(async () => {
  enableConnector();
  await startDb();
});
afterAll(async () => {
  await stopDb();
  disableConnector();
});
beforeEach(async () => {
  await resetDb();
  await seedUsers();
});

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = pkceChallenge(VERIFIER);
const READ_WRITE: Scope[] = ["slate:boards:read", "slate:boards:write"];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json;

const authorizeParams = (over: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: HUB.clientId,
    redirect_uri: HUB.redirectUri,
    scope: "slate:boards:read slate:boards:write",
    state: "st-123",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  });
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) p.delete(k);
    else p.set(k, v);
  }
  return p;
};

/** What the consent screen does after the user clicks Allow. */
const consent = (workspaceId: string, userId = EDITOR.subject, scopes: readonly Scope[] = READ_WRITE) =>
  createAuthCode({ clientId: HUB.clientId, userId, workspaceId, scopes, redirectUri: HUB.redirectUri, codeChallenge: CHALLENGE });

const token = (form: Record<string, string>, headers: Record<string, string> = { authorization: basicAuth() }) =>
  tokenRoute(req("/api/connect/v1/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, rawBody: new URLSearchParams(form).toString() }));

const exchange = (code: string, over: Record<string, string> = {}) => token({ grant_type: "authorization_code", code, redirect_uri: HUB.redirectUri, code_verifier: VERIFIER, ...over });
const refresh = (refresh_token: string, over: Record<string, string> = {}) => token({ grant_type: "refresh_token", refresh_token, ...over });
const revoke = (form: Record<string, string>, headers: Record<string, string> = { authorization: basicAuth() }) =>
  revokeRoute(req("/api/connect/v1/oauth/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, rawBody: new URLSearchParams(form).toString() }));
const me = (accessToken: string) => meRoute(req("/api/connect/v1/me", { headers: bearer(accessToken) }));

async function connect(workspaceId: string, userId = EDITOR.subject, scopes: readonly Scope[] = READ_WRITE) {
  const res = await exchange(await consent(workspaceId, userId, scopes));
  expect(res.status).toBe(200);
  return (await json(res)) as { access_token: string; refresh_token: string; scope: string; expires_in: number; tenant: Json; user: Json };
}

describe("the authorize request (2.1)", () => {
  it("accepts a complete request for the registered Hub", () => {
    const v = validateAuthorizeRequest(authorizeParams());
    expect(v).toEqual({ kind: "ok", request: { clientId: HUB.clientId, redirectUri: HUB.redirectUri, scopes: READ_WRITE, state: "st-123", codeChallenge: CHALLENGE } });
  });

  it("shows an error page and never redirects for an unknown client or an unregistered redirect URI (C04)", () => {
    const bad = [
      authorizeParams({ client_id: "someone-else" }),
      authorizeParams({ client_id: undefined }),
      authorizeParams({ redirect_uri: "https://evil.example.com/cb" }),
      authorizeParams({ redirect_uri: HUB.redirectUri + "/" }), // exact match only
      authorizeParams({ redirect_uri: HUB.redirectUri + "?x=1" }),
      authorizeParams({ redirect_uri: HUB.redirectUri.toUpperCase() }),
      authorizeParams({ redirect_uri: "https://hub.example.com" }),
      authorizeParams({ redirect_uri: undefined }),
    ];
    for (const p of bad) expect(validateAuthorizeRequest(p).kind, p.toString()).toBe("page_error");
  });

  it("sends other mistakes back to the Hub with error and state (RFC 6749)", () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge_method: "plain" }, "invalid_request"], // PKCE with S256 is mandatory
      [{ code_challenge_method: undefined }, "invalid_request"],
      [{ code_challenge: undefined }, "invalid_request"],
      [{ code_challenge: "short" }, "invalid_request"],
      [{ scope: "slate:boards:read nope" }, "invalid_scope"],
      [{ scope: "" }, "invalid_scope"],
      [{ scope: undefined }, "invalid_scope"],
    ];
    for (const [over, error] of cases) {
      const v = validateAuthorizeRequest(authorizeParams(over));
      expect(v, JSON.stringify(over)).toMatchObject({ kind: "redirect_error", error, redirectUri: HUB.redirectUri, state: "st-123" });
    }
    const noState = validateAuthorizeRequest(authorizeParams({ state: undefined }));
    expect(noState).toMatchObject({ kind: "redirect_error", error: "invalid_request" });
    expect(errorRedirect(noState as never)).not.toContain("state=");
    const repeated = new URLSearchParams(authorizeParams());
    repeated.append("scope", "slate:boards:read");
    expect(validateAuthorizeRequest(repeated)).toMatchObject({ kind: "redirect_error", error: "invalid_request" });
  });

  it("builds redirect URLs that keep the Hub's own query", () => {
    expect(redirectWith("https://hub.example.com/cb?tenant=7", { code: "abc", state: "s" })).toBe("https://hub.example.com/cb?tenant=7&code=abc&state=s");
  });

  it("pairs webhooks with the event log so missed deliveries can be healed", () => {
    const v = validateAuthorizeRequest(authorizeParams({ scope: "slate:webhooks:manage" }));
    expect(v.kind === "ok" && v.request.scopes).toEqual(["slate:events:read", "slate:webhooks:manage"]);
  });
});

describe("the signed consent blob", () => {
  const request = { clientId: HUB.clientId, redirectUri: HUB.redirectUri, scopes: READ_WRITE, state: "s", codeChallenge: CHALLENGE };

  it("carries the validated request to the server action, for the same user only", () => {
    const blob = signConsent(request, EDITOR.subject);
    expect(verifyConsent(blob, EDITOR.subject)).toEqual(request);
    expect(verifyConsent(blob, VIEWER.subject)).toBeNull(); // another account
  });

  it("rejects tampering, truncation and expiry", () => {
    const blob = signConsent(request, EDITOR.subject, 1_000);
    expect(verifyConsent(blob, EDITOR.subject, 1_000 + 11 * 60_000)).toBeNull();
    const [payload, sig] = blob.split(".");
    const forged = Buffer.from(JSON.stringify({ ...request, scopes: ALL_SCOPES, userId: EDITOR.subject, exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifyConsent(`${forged}.${sig}`, EDITOR.subject)).toBeNull();
    expect(verifyConsent(`${payload}.`, EDITOR.subject)).toBeNull();
    expect(verifyConsent("garbage", EDITOR.subject)).toBeNull();
    expect(verifyConsent("", EDITOR.subject)).toBeNull();
  });
});

describe("the token endpoint: authorization code (2.2)", () => {
  it("exchanges a code for tokens in the CP1 response shape and stores only hashes", async () => {
    const { workspaceId } = await setup();
    const res = await exchange(await consent(workspaceId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    const body = await json(res);
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "slate:boards:read slate:boards:write",
      tenant: { id: workspaceId, name: "WS", kind: "workspace" },
      user: { id: EDITOR.subject, email: "editor@example.com", name: "Edie Editor" },
    });
    expect(body.access_token).toMatch(/^cp1_slate_[A-Za-z0-9_-]{43,}$/);
    expect(body.refresh_token).toMatch(/^cp1r_slate_[A-Za-z0-9_-]{43,}$/);

    const c = await getCollections();
    const grants = await c.connectorGrants.find({}).toArray();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ clientId: HUB.clientId, userId: EDITOR.subject, workspaceId, scopes: READ_WRITE });
    expect(grants[0].refreshExpiresAt - grants[0].createdAt).toBe(90 * 86_400_000);
    expect(grants[0].accessExpiresAt - grants[0].createdAt).toBe(3_600_000);
    expect(JSON.stringify(grants)).not.toContain(body.access_token);
    expect(JSON.stringify(grants)).not.toContain(body.refresh_token);
    const codes = await c.connectorCodes.find({}).toArray();
    expect(codes[0]._id).toMatch(/^[0-9a-f]{64}$/); // the code is stored as an HMAC too
    expect(codes[0].grantId).toBe(grants[0]._id);
  });

  it("works for the minted token straight away", async () => {
    const { workspaceId } = await setup();
    const t = await connect(workspaceId);
    expect((await me(t.access_token)).status).toBe(200);
  });

  it("requires the right PKCE verifier, and a failed try burns the code (C02)", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId);
    const wrong = await exchange(code, { code_verifier: "A".repeat(43) });
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toBe("invalid_grant");
    expect((await exchange(code)).status).toBe(400); // even the right verifier is too late now
    expect(await (await getCollections()).connectorGrants.countDocuments()).toBe(0);
  });

  it("rejects a missing verifier, missing fields and a verifier of the wrong shape", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId);
    const noVerifier = await token({ grant_type: "authorization_code", code, redirect_uri: HUB.redirectUri });
    expect(noVerifier.status).toBe(400);
    expect((await json(noVerifier)).error).toBe("invalid_request");
    expect((await exchange(code, { code_verifier: "short" })).status).toBe(400);
    expect((await token({ grant_type: "authorization_code" })).status).toBe(400);
  });

  it("is single use: the second redemption fails and revokes the tokens of the first (C03)", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId);
    const first = await json(await exchange(code));
    expect((await me(first.access_token)).status).toBe(200);

    const second = await exchange(code);
    expect(second.status).toBe(400);
    expect((await json(second)).error).toBe("invalid_grant");
    expect((await me(first.access_token)).status).toBe(401);
    expect((await refresh(first.refresh_token)).status).toBe(400);
  });

  it("lets at most one of several parallel redemptions through, and no grant survives the replay", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId);
    const results = await Promise.all([exchange(code), exchange(code), exchange(code)]);
    const wins = results.filter((r) => r.status === 200);
    expect(wins.length).toBeLessThanOrEqual(1);
    const c = await getCollections();
    // whichever way the race went, a double redemption leaves nothing alive
    expect(await c.connectorGrants.countDocuments({ revokedAt: { $exists: false } })).toBe(0);
    for (const win of wins) expect((await me((await json(win)).access_token)).status).toBe(401);
  });

  it("requires the exact redirect_uri of the authorization request (C04)", async () => {
    const { workspaceId } = await setup();
    for (const uri of [HUB.redirectUri + "/", "https://hub.example.com/other", HUB.redirectUri + "?a=1"]) {
      const res = await exchange(await consent(workspaceId), { redirect_uri: uri });
      expect(res.status, uri).toBe(400);
      expect((await json(res)).error).toBe("invalid_grant");
    }
  });

  it("expires codes after 60 seconds", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId);
    const c = await getCollections();
    const row = (await c.connectorCodes.find({}).toArray())[0];
    expect(row.expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
    expect(row.expiresAt - Date.now()).toBeGreaterThan(55_000);
    await c.connectorCodes.updateOne({ _id: row._id }, { $set: { expiresAt: Date.now() - 1 } });
    expect((await exchange(code)).status).toBe(400);
  });

  it("refuses a code whose user lost the role in the meantime", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId, EDITOR.subject, READ_WRITE);
    const c = await getCollections();
    await c.workspaceMembers.updateOne({ workspaceId, userId: EDITOR.subject }, { $set: { role: "Viewer" } });
    expect((await exchange(code)).status).toBe(400);
  });

  it("rejects an unknown code and unsupported grant types", async () => {
    expect((await exchange("cp1c_slate_" + "z".repeat(43))).status).toBe(400);
    const res = await token({ grant_type: "password", username: "a", password: "b" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("unsupported_grant_type");
  });
});

describe("client authentication", () => {
  it("accepts HTTP Basic, form fields and a JSON body, and nothing else", async () => {
    const { workspaceId } = await setup();
    const basic = await exchange(await consent(workspaceId));
    expect(basic.status).toBe(200);

    const inBody = await token({ grant_type: "authorization_code", code: await consent(workspaceId), redirect_uri: HUB.redirectUri, code_verifier: VERIFIER, client_id: HUB.clientId, client_secret: HUB.clientSecret }, {});
    expect(inBody.status).toBe(200);

    const asJson = await tokenRoute(
      req("/api/connect/v1/oauth/token", {
        method: "POST",
        headers: { authorization: basicAuth() },
        body: { grant_type: "authorization_code", code: await consent(workspaceId), redirect_uri: HUB.redirectUri, code_verifier: VERIFIER },
      })
    );
    expect(asJson.status).toBe(200);

    const failing: Record<string, string>[] = [{}, { authorization: basicAuth(HUB.clientId, "wrong-secret-0123456789abcdefghijklmnopq") }, { authorization: basicAuth("other-client", HUB.clientSecret) }, { authorization: "Basic !!!" }];
    for (const headers of failing) {
      const denied = await token({ grant_type: "authorization_code", code: await consent(workspaceId), redirect_uri: HUB.redirectUri, code_verifier: VERIFIER }, headers);
      expect(denied.status, JSON.stringify(headers)).toBe(401);
      expect((await json(denied)).error).toBe("invalid_client");
    }
  });

  it("never treats a bad secret as a reason to burn the code", async () => {
    const { workspaceId } = await setup();
    const code = await consent(workspaceId);
    expect((await token({ grant_type: "authorization_code", code, redirect_uri: HUB.redirectUri, code_verifier: VERIFIER }, { authorization: basicAuth(HUB.clientId, "nope-nope-nope-nope-nope-nope-nope") })).status).toBe(401);
    expect((await exchange(code)).status).toBe(200);
  });

  it("answers in the RFC 6749 error shape with a request id", async () => {
    const res = await token({ grant_type: "authorization_code" }, {});
    const body = await json(res);
    expect(body).toMatchObject({ error: "invalid_client", error_description: expect.any(String), request_id: res.headers.get("x-request-id") });
  });
});

describe("refresh tokens: rotation and theft detection (C05)", () => {
  it("hands out a new pair, kills the old access token at once, and keeps the grant", async () => {
    const { workspaceId } = await setup();
    const first = await connect(workspaceId);
    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(200);
    const second = await json(res);
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.scope).toBe(first.scope);
    expect(second.tenant.id).toBe(workspaceId);

    expect((await me(first.access_token)).status).toBe(401);
    expect((await me(second.access_token)).status).toBe(200);
    const c = await getCollections();
    expect(await c.connectorGrants.countDocuments()).toBe(1);
  });

  it("revokes the whole grant when an old refresh token is presented again", async () => {
    const { workspaceId } = await setup();
    const first = await connect(workspaceId);
    const second = await json(await refresh(first.refresh_token));
    const third = await json(await refresh(second.refresh_token));
    expect((await me(third.access_token)).status).toBe(200);

    const replay = await refresh(first.refresh_token); // a stolen, already-rotated token
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe("invalid_grant");
    expect((await me(third.access_token)).status).toBe(401); // the legitimate holder is locked out too
    expect((await refresh(third.refresh_token)).status).toBe(400);
    const c = await getCollections();
    expect((await c.connectorGrants.findOne({}))!.revokedReason).toBe("refresh_token_reuse");
  });

  it("lets only one of two simultaneous refreshes through, then closes the grant", async () => {
    const { workspaceId } = await setup();
    const first = await connect(workspaceId);
    const [a, b] = await Promise.all([refresh(first.refresh_token), refresh(first.refresh_token)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const winner = await json(a.status === 200 ? a : b);
    expect((await me(winner.access_token)).status).toBe(401);
  });

  it("can only narrow the scopes", async () => {
    const { workspaceId } = await setup();
    const first = await connect(workspaceId);
    const wider = await refresh(first.refresh_token, { scope: "slate:boards:read slate:ai:generate" });
    expect(wider.status).toBe(400);
    expect((await json(wider)).error).toBe("invalid_scope");
    const unknown = await refresh(first.refresh_token, { scope: "slate:everything" });
    expect((await json(unknown)).error).toBe("invalid_scope");
    const narrower = await json(await refresh(first.refresh_token, { scope: "slate:boards:read" }));
    expect(narrower.scope).toBe("slate:boards:read");
  });

  it("refuses expired tokens, access tokens, other users' leftovers and users who left", async () => {
    const { workspaceId } = await setup();
    const t = await connect(workspaceId);
    expect((await refresh(t.access_token)).status).toBe(400); // an access token is not a refresh token
    expect((await refresh("cp1r_slate_" + "q".repeat(43))).status).toBe(400);

    const c = await getCollections();
    await c.connectorGrants.updateOne({}, { $set: { refreshExpiresAt: Date.now() - 1 } });
    expect((await refresh(t.refresh_token)).status).toBe(400);

    await c.connectorGrants.updateOne({}, { $set: { refreshExpiresAt: Date.now() + 100_000 } });
    await c.workspaceMembers.deleteOne({ workspaceId, userId: EDITOR.subject });
    expect((await refresh(t.refresh_token)).status).toBe(400);
  });
});

describe("revoking (C06)", () => {
  it("blocks the very next call, whether the access or the refresh token is presented", async () => {
    const { workspaceId } = await setup();
    const a = await connect(workspaceId);
    expect((await me(a.access_token)).status).toBe(200);
    expect((await revoke({ token: a.access_token })).status).toBe(200);
    expect((await me(a.access_token)).status).toBe(401);
    expect((await refresh(a.refresh_token)).status).toBe(400);

    const b = await connect(workspaceId);
    expect((await revoke({ token: b.refresh_token, token_type_hint: "refresh_token" })).status).toBe(200);
    expect((await me(b.access_token)).status).toBe(401);
  });

  it("answers 200 for unknown or already revoked tokens, 400 without a token, 401 without client credentials", async () => {
    const { workspaceId } = await setup();
    const a = await connect(workspaceId);
    expect((await revoke({ token: "cp1_slate_" + "n".repeat(43) })).status).toBe(200);
    expect((await revoke({ token: a.access_token })).status).toBe(200);
    expect((await revoke({ token: a.access_token })).status).toBe(200);
    expect((await revoke({})).status).toBe(400);
    expect((await revoke({ token: a.access_token }, {})).status).toBe(401);
  });

  it("removes the webhook endpoints the grant registered", async () => {
    const { workspaceId } = await setup();
    const a = await connect(workspaceId);
    const c = await getCollections();
    const grantId = (await c.connectorGrants.findOne({}))!._id;
    const now = Date.now();
    await c.connectorWebhooks.insertOne({ _id: newDocId(), grantId, workspaceId, url: "https://hub.example.com/hook", events: ["board.*"], secretEnc: "enc", status: "active", consecutiveFailures: 0, createdAt: now, updatedAt: now });
    await revoke({ token: a.access_token });
    expect(await c.connectorWebhooks.countDocuments({ grantId })).toBe(0);
  });
});

describe("GET /me", () => {
  it("describes the connection: user, workspace and role, live scopes, plan, capabilities", async () => {
    const { workspaceId } = await setup();
    const t = await connect(workspaceId);
    const body = await json(await me(t.access_token));
    expect(body).toMatchObject({
      user: { id: EDITOR.subject, email: "editor@example.com", name: "Edie Editor" },
      tenant: { id: workspaceId, name: "WS", kind: "workspace", role: "Editor" },
      scopes: READ_WRITE,
      // setup() leaves one board in the workspace, owned by OWNER's free plan
      plan: { name: "Free", limits: { maxBoards: 3, aiCreditsMonthly: 15 }, usage: { boards: 1, aiCredits: 0 } },
      capabilities: { aiCreditsRemaining: 15, boardsUsed: 1, boardsCap: 3 },
    });
    expect(typeof body.grantId).toBe("string");
    expect(typeof body.capabilities.aiAvailable).toBe("boolean");
  });

  it("narrows the scopes to what the role allows right now", async () => {
    const { workspaceId } = await setup();
    const t = await connect(workspaceId);
    const c = await getCollections();
    await c.workspaceMembers.updateOne({ workspaceId, userId: EDITOR.subject }, { $set: { role: "Viewer" } });
    const body = await json(await me(t.access_token));
    expect(body.tenant.role).toBe("Viewer");
    expect(body.scopes).toEqual(["slate:boards:read"]);
  });

  it("needs a token and answers in the error shape without one", async () => {
    const res = await meRoute(req("/api/connect/v1/me"));
    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe("unauthorized");
  });
});

describe("the scripted flow end to end", () => {
  it("validate -> consent -> code -> tokens -> call -> refresh -> call -> revoke -> blocked", async () => {
    const { workspaceId } = await setup();
    const v = validateAuthorizeRequest(authorizeParams({ scope: "slate:boards:read slate:ai:generate" }));
    if (v.kind !== "ok") throw new Error("request should be valid");
    const blob = signConsent(v.request, EDITOR.subject);
    const verified = verifyConsent(blob, EDITOR.subject)!;

    const code = await createAuthCode({ ...verified, userId: EDITOR.subject, workspaceId });
    const redirect = new URL(redirectWith(verified.redirectUri, { code, state: verified.state }));
    expect(redirect.searchParams.get("state")).toBe("st-123");

    const t = await json(await exchange(redirect.searchParams.get("code")!));
    expect((await me(t.access_token)).status).toBe(200);
    const next = await json(await refresh(t.refresh_token));
    expect((await me(t.access_token)).status).toBe(401);
    expect((await me(next.access_token)).status).toBe(200);
    expect((await revoke({ token: next.access_token })).status).toBe(200);
    expect((await me(next.access_token)).status).toBe(401);
  });
});

describe("Connected apps (RPC behind the settings panel)", () => {
  it("lists a workspace's connections for its Admin, and only their own for other members", async () => {
    const { workspaceId } = await setup();
    await connect(workspaceId, EDITOR.subject);
    await connect(workspaceId, OWNER.subject, ["slate:boards:read"]);

    const admin = await as(OWNER).query(api.connector.overview, { workspaceId });
    expect(admin).toMatchObject({ hubName: HUB.name, seesAll: true });
    expect(admin!.grants).toHaveLength(2);
    expect(admin!.grants.find((g) => g.connectedBy.isYou)!.scopes).toEqual(["slate:boards:read"]);

    const editor = await as(EDITOR).query(api.connector.overview, { workspaceId });
    expect(editor!.seesAll).toBe(false);
    expect(editor!.grants).toHaveLength(1);
    expect(editor!.grants[0].connectedBy.isYou).toBe(true);

    expect(await as(STRANGER).query(api.connector.overview, { workspaceId })).toBeNull(); // not a member
    expect(await as(null).query(api.connector.overview, { workspaceId })).toBeNull();
  });

  it("shows the last audited calls of the visible connections", async () => {
    const { workspaceId } = await setup();
    const t = await connect(workspaceId);
    await me(t.access_token);
    const view = await as(EDITOR).query(api.connector.overview, { workspaceId });
    expect(view!.activity[0]).toMatchObject({ method: "GET", route: "/me", status: 200 });
  });

  it("lets the owner of a connection or an Admin disconnect it, nobody else", async () => {
    const { workspaceId } = await setup();
    const mine = await connect(workspaceId, EDITOR.subject);
    const grantId = (await (await getCollections()).connectorGrants.findOne({}))!._id;

    await expect(as(VIEWER).mutation(api.connector.revoke, { grantId })).rejects.toThrow(/Unauthorized/);
    await expect(as(STRANGER).mutation(api.connector.revoke, { grantId })).rejects.toThrow(/Unauthorized/);
    expect((await me(mine.access_token)).status).toBe(200);

    await as(OWNER).mutation(api.connector.revoke, { grantId }); // an Admin who is not the owner of the grant
    expect((await me(mine.access_token)).status).toBe(401);
    await expect(as(OWNER).mutation(api.connector.revoke, { grantId })).rejects.toThrow(/no longer exists/);

    const own = await connect(workspaceId, EDITOR.subject);
    const ownId = (await (await getCollections()).connectorGrants.findOne({ revokedAt: { $exists: false } }))!._id;
    await as(EDITOR).mutation(api.connector.revoke, { grantId: ownId });
    expect((await me(own.access_token)).status).toBe(401);
  });
});
