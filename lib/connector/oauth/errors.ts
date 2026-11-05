/**
 * OAuth endpoints (authorize, token, revoke) speak RFC 6749, not the CP1 error object: a standard OAuth client
 * library expects `{ "error": "invalid_grant", "error_description": "..." }`.
 */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  | "access_denied"
  | "server_error"
  | "temporarily_unavailable";

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(code: OAuthErrorCode, description: string, opts: { status?: number; headers?: Record<string, string> } = {}) {
    super(description);
    this.name = "OAuthError";
    this.code = code;
    this.status = opts.status ?? (code === "invalid_client" ? 401 : code === "server_error" ? 500 : code === "temporarily_unavailable" ? 503 : 400);
    this.headers = opts.headers ?? {};
  }
}
