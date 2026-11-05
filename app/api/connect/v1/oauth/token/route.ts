import { OAuthError } from "@/lib/connector/oauth/errors";
import { exchangeAuthCode, rotateRefreshToken, tokenResponse } from "@/lib/connector/oauth/grants";
import { oauthRoute } from "@/lib/connector/oauth/http";
import { parseScopeParam } from "@/lib/connector/scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/connect/v1/oauth/token (RFC 6749 §4.1.3 and §6). The Hub authenticates with HTTP Basic or in the body.
 *   grant_type=authorization_code  code, redirect_uri, code_verifier
 *   grant_type=refresh_token       refresh_token   (rotating: the old one dies, re-use revokes the grant)
 */
export const POST = oauthRoute(async ({ form, clientId }) => {
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const codeVerifier = form.get("code_verifier");
    if (!code || !redirectUri || !codeVerifier) throw new OAuthError("invalid_request", "code, redirect_uri and code_verifier are required");
    const { grant, tokens } = await exchangeAuthCode({ code, redirectUri, codeVerifier, clientId });
    return await tokenResponse(grant, tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required");
    const requested = form.get("scope");
    const { scopes, unknown } = parseScopeParam(requested);
    if (unknown.length > 0) throw new OAuthError("invalid_scope", `Unknown scope: ${unknown.join(" ")}`);
    const { grant, tokens } = await rotateRefreshToken({ refreshToken, clientId, ...(requested ? { scopes } : {}) });
    return await tokenResponse(grant, tokens);
  }

  throw new OAuthError("unsupported_grant_type", 'grant_type must be "authorization_code" or "refresh_token"');
});
