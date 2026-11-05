import { connectorConfig } from "../config";
import { isValidCodeChallenge, safeEqual } from "../crypto";
import { parseScopeParam, type Scope } from "../scopes";
import type { OAuthErrorCode } from "./errors";

/** A validated authorization request: everything the consent screen and the code need. */
export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  scopes: Scope[];
  state: string;
  codeChallenge: string;
}

export type AuthorizeValidation =
  /** The client or the redirect URI is wrong: show an error page and never redirect (RFC 6749 §4.1.2.1). */
  | { kind: "page_error"; title: string; message: string }
  /** Anything else wrong with the request goes back to the (now trusted) redirect URI. */
  | { kind: "redirect_error"; redirectUri: string; error: OAuthErrorCode; description: string; state?: string }
  | { kind: "ok"; request: AuthorizeRequest };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params): { values: Map<string, string>; repeated: string[] } {
  const values = new Map<string, string>();
  const repeated: string[] = [];
  const entries: [string, string | string[] | undefined][] = params instanceof URLSearchParams ? [...params.keys()].map((k) => [k, params.getAll(k).length > 1 ? params.getAll(k) : params.get(k) ?? undefined]) : Object.entries(params);
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      repeated.push(key);
      if (value[0] !== undefined) values.set(key, value[0]);
    } else if (value !== undefined) values.set(key, value);
  }
  return { values, repeated };
}

/**
 * Checks `GET /connect/authorize?...` against the registered Hub. The order matters: until `client_id` and
 * `redirect_uri` are proven to be the Hub's, nothing may be redirected (that would make this an open redirector).
 */
export function validateAuthorizeRequest(params: Params): AuthorizeValidation {
  const config = connectorConfig();
  const { values, repeated } = read(params);

  const clientId = values.get("client_id") ?? "";
  if (!clientId || !safeEqual(clientId, config.clientId)) {
    return { kind: "page_error", title: "Unknown application", message: "This link is not valid: the application that sent you here is not registered with Slate." };
  }
  const redirectUri = values.get("redirect_uri") ?? "";
  if (!redirectUri || !config.redirectUris.includes(redirectUri)) {
    return { kind: "page_error", title: "Invalid redirect address", message: "This link is not valid: the address Slate would send you back to is not registered for this application." };
  }

  const state = values.get("state");
  const fail = (error: OAuthErrorCode, description: string): AuthorizeValidation => ({ kind: "redirect_error", redirectUri, error, description, ...(state ? { state } : {}) });

  if (repeated.length > 0) return fail("invalid_request", `Parameter "${repeated[0]}" must not be repeated`);
  if (!state) return fail("invalid_request", "state is required");
  if (values.get("response_type") !== "code") return fail("unsupported_response_type", 'response_type must be "code"');

  const challenge = values.get("code_challenge");
  if (values.get("code_challenge_method") !== "S256") return fail("invalid_request", 'PKCE is required: code_challenge_method must be "S256"');
  if (!challenge || !isValidCodeChallenge(challenge)) return fail("invalid_request", "code_challenge must be the base64url SHA-256 of the code verifier");

  const { scopes, unknown } = parseScopeParam(values.get("scope"));
  if (unknown.length > 0) return fail("invalid_scope", `Unknown scope: ${unknown.join(" ")}`);
  if (scopes.length === 0) return fail("invalid_scope", "scope is required");

  return { kind: "ok", request: { clientId, redirectUri, scopes, state, codeChallenge: challenge } };
}

/** `redirectUri` with `?error=...&state=...` (or `?code=...&state=...`) added, keeping any query it already had. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

export const errorRedirect = (v: Extract<AuthorizeValidation, { kind: "redirect_error" }>): string =>
  redirectWith(v.redirectUri, { error: v.error, error_description: v.description, state: v.state });
