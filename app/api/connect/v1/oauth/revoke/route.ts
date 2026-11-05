import { OAuthError } from "@/lib/connector/oauth/errors";
import { revokeByToken } from "@/lib/connector/oauth/grants";
import { oauthRoute } from "@/lib/connector/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/connect/v1/oauth/revoke (RFC 7009). Revokes the grant behind an access or refresh token at once and
 * removes the webhooks it registered. An unknown or already revoked token is not an error: the answer is 200.
 */
export const POST = oauthRoute(async ({ form, clientId }) => {
  const token = form.get("token");
  if (!token) throw new OAuthError("invalid_request", "token is required");
  await revokeByToken(token, clientId);
  return {};
});
