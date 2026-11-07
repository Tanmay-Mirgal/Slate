import { connectorConfig, connectorEnabled } from "../config";
import { safeEqual } from "../crypto";
import { ConnectError, err, errorBody } from "../errors";
import { requestIdOf, readLimited } from "../http";
import { takeConnectorToken } from "../ratelimit";
import { OAuthError } from "./errors";

/**
 * Wrapper for the token and revoke endpoints: flag check, request id, form-or-JSON body, authentication of the
 * Hub (HTTP Basic or body), a per-address limit against guessing, and RFC 6749 error bodies.
 */

const MAX_BODY = 16 * 1024;
/** Requests per minute per client address. A real Hub makes a handful of refreshes per hour per user. */
const PER_ADDRESS_PER_MINUTE = 300;

export interface OAuthCall {
  req: Request;
  requestId: string;
  form: URLSearchParams;
  clientId: string;
}

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

function clientAddress(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

async function readForm(req: Request): Promise<URLSearchParams> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const text = await readLimited(req, MAX_BODY);
  if (type.includes("application/json")) {
    let value: unknown;
    try {
      value = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new OAuthError("invalid_request", "The request body must be valid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthError("invalid_request", "The request body must be a JSON object");
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(value)) if (typeof v === "string") form.set(k, v);
    return form;
  }
  if (type.includes("application/x-www-form-urlencoded") || text === "") return new URLSearchParams(text);
  throw new OAuthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded or application/json");
}

/** Client authentication (RFC 6749 §2.3.1): Basic header, or client_id + client_secret in the body. */
function authenticateClient(req: Request, form: URLSearchParams): string {
  const config = connectorConfig();
  let id = "";
  let secret = "";
  const header = req.headers.get("authorization");
  const basic = header && /^Basic\s+(\S+)$/i.exec(header);
  if (basic) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const at = decoded.indexOf(":");
    if (at > 0) {
      try {
        id = decodeURIComponent(decoded.slice(0, at));
        secret = decodeURIComponent(decoded.slice(at + 1));
      } catch {
        id = decoded.slice(0, at);
        secret = decoded.slice(at + 1);
      }
    }
  } else {
    id = form.get("client_id") ?? "";
    secret = form.get("client_secret") ?? "";
  }
  const cleanId = id.trim().replace(/^["']|["']$/g, "");
  const cleanSecret = secret.trim().replace(/^["']|["']$/g, "");
  const configId = config.clientId.trim().replace(/^["']|["']$/g, "");
  const configSecret = config.clientSecret.trim().replace(/^["']|["']$/g, "");

  // both comparisons always run, so a wrong id and a wrong secret cost the same
  const idOk = safeEqual(cleanId, configId);
  const secretOk = safeEqual(cleanSecret, configSecret);
  if (!id || !secret || !idOk || !secretOk) {
    const detail = `id: ${idOk ? "OK" : `${cleanId.length}vs${configId.length}`}, secret: ${secretOk ? "OK" : `${cleanSecret.length}vs${configSecret.length} (prefix: ${cleanSecret.slice(0, 3)}... vs ${configSecret.slice(0, 3)}...)`}`;
    console.error("[oauth client auth failure]", detail);
    throw new OAuthError("invalid_client", `Client authentication failed (${detail})`, { headers: basic ? { "WWW-Authenticate": 'Basic realm="slate-connector"' } : {} });
  }
  return id;
}

export function oauthRoute(handler: (c: OAuthCall) => Promise<unknown>) {
  return async function route(req: Request): Promise<Response> {
    const requestId = requestIdOf(req);
    const base = { "Content-Type": "application/json; charset=utf-8", "X-Request-Id": requestId, ...noStore };
    if (!connectorEnabled()) return new Response(JSON.stringify(errorBody(err.notFound("Route"), requestId)), { status: 404, headers: base });
    try {
      const form = await readForm(req);
      const rl = await takeConnectorToken(`oauth:${clientAddress(req)}`, PER_ADDRESS_PER_MINUTE, 60_000);
      if (!rl.allowed) throw new OAuthError("temporarily_unavailable", "Too many requests", { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))) } });
      const clientId = authenticateClient(req, form);
      const body = await handler({ req, requestId, form, clientId });
      return new Response(JSON.stringify(body), { status: 200, headers: base });
    } catch (e) {
      if (e instanceof OAuthError) {
        return new Response(JSON.stringify({ error: e.code, error_description: e.message, request_id: requestId }), { status: e.status, headers: { ...base, ...e.headers } });
      }
      if (e instanceof ConnectError && e.status === 413) return new Response(JSON.stringify({ error: "invalid_request", error_description: e.message, request_id: requestId }), { status: 413, headers: base });
      console.error(`[connector] ${requestId} oauth endpoint failed:`, e instanceof Error ? `${e.name}: ${e.message}` : e);
      return new Response(JSON.stringify({ error: "server_error", error_description: "Something went wrong on our side", request_id: requestId }), { status: 500, headers: base });
    }
  };
}
