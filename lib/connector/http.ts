import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticate, requireScopes, type AuthedGrant } from "./auth/verify";
import { writeAudit } from "./audit";
import { connectorEnabled, LIMITS } from "./config";
import { ConnectError, err, errorBody, normalizeError, zodDetails } from "./errors";
import { abandonIdempotent, beginIdempotent, finishIdempotent, parseIdempotencyKey, requestFingerprint } from "./idempotency";
import { takeConnectorToken } from "./ratelimit";
import type { Scope } from "./scopes";

/**
 * The one request pipeline every connector endpoint goes through, so the cross-cutting rules of CP1 live in a
 * single place instead of being repeated (and forgotten) in each route:
 *
 *   flag off -> 404 · request id · body size cap · bearer auth · per-grant rate limit · scope + live role ·
 *   idempotency · strict input validation · error shape · audit row · no CORS headers
 */

export type RouteResult = Response | { status?: number; body?: unknown; headers?: Record<string, string> };

export const ok = (body: unknown, status = 200, headers?: Record<string, string>): RouteResult => ({ status, body, headers });

export interface RouteCall<P> {
  req: Request;
  url: URL;
  params: P;
  requestId: string;
  /** `Prefer: unknown-fields=ignore` was sent: unknown input fields are dropped instead of rejected. */
  ignoreUnknown: boolean;
  text(): Promise<string>;
  /** The JSON body (`undefined` when there is none). Invalid JSON is a 400. */
  json(): Promise<unknown>;
  /** Strict validation: unknown fields are rejected unless the caller asked to have them ignored. */
  parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S>;
  /** Names the call in the audit log (an action name is more useful than its URL). */
  audit(name: string): void;
}

export interface TokenRouteCall<P> extends RouteCall<P> {
  grant: AuthedGrant;
}

interface RouteSpec {
  /** Route pattern for the audit log, e.g. `/boards/{id}`. Never contains real ids. */
  route: string;
  /** Scopes the endpoint needs (all of them). Handlers whose scope depends on the input check it themselves. */
  scopes?: readonly Scope[];
  /** Honour `Idempotency-Key` on POST. */
  idempotent?: boolean;
  maxBodyBytes?: number;
  cacheControl?: string;
  /** Skip the per-grant rate limit (only for endpoints that must work when the limit is hit). */
  noRateLimit?: boolean;
}

/* ------------------------------------------------------------------ helpers */

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestIdOf(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && REQUEST_ID.test(given) ? given : `req_${randomBytes(10).toString("hex")}`;
}

const tooLarge = (max: number) => new ConnectError("validation_failed", `The request body is larger than ${max} bytes`, { status: 413 });

/** Reads at most `max` bytes, so a chunked upload without a Content-Length cannot buffer an unbounded body. */
export async function readLimited(req: Request, max: number): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw tooLarge(max);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(max);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Strict zod parsing with the CP1 forward-compatibility rule: unknown fields are an error, unless
 * `Prefer: unknown-fields=ignore` was sent, in which case they are removed and the rest is validated.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown, ignoreUnknown: boolean): z.output<S> {
  const current: unknown = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  for (let pass = 0; pass < 5; pass++) {
    const result = schema.safeParse(current);
    if (result.success) return result.data;
    const unknownKeys = ignoreUnknown ? result.error.issues.filter((i) => i.code === "unrecognized_keys") : [];
    if (unknownKeys.length === 0) throw err.validation("The request is not valid", zodDetails(result.error));
    for (const issue of unknownKeys) {
      let target: unknown = current;
      for (const key of issue.path) target = (target as Record<PropertyKey, unknown> | undefined)?.[key];
      if (target && typeof target === "object") for (const k of (issue as unknown as { keys: string[] }).keys) delete (target as Record<string, unknown>)[k];
    }
  }
  throw err.validation("The request is not valid");
}

function render(result: RouteResult, headers: Headers): { response: Response; status: number; text: string } {
  if (result instanceof Response) return { response: result, status: result.status, text: "" };
  const status = result.status ?? 200;
  const text = result.body === undefined || status === 204 ? "" : JSON.stringify(result.body);
  for (const [k, v] of Object.entries(result.headers ?? {})) headers.set(k, v);
  if (status === 204) headers.delete("Content-Type");
  return { response: new Response(status === 204 ? null : text, { status, headers }), status, text };
}

/* ------------------------------------------------------------------ the pipeline */

type AnyHandler<P> = (c: TokenRouteCall<P>) => Promise<RouteResult>;

function build<P>(auth: "public" | "token", spec: RouteSpec, handler: AnyHandler<P>) {
  return async function route(req: Request, routeCtx?: { params: Promise<P> }): Promise<Response> {
    const started = Date.now();
    const requestId = requestIdOf(req);
    const url = new URL(req.url);
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": spec.cacheControl ?? "no-store",
      "X-Request-Id": requestId,
    });
    let grant: AuthedGrant | null = null;
    let auditName = spec.route;
    let status = 500;
    let idem: { grantId: string; key: string } | null = null;

    try {
      // C22: with the flag off there is nothing here at all, and nothing below runs (no queries, no audit).
      if (!connectorEnabled()) {
        headers.set("Cache-Control", "no-store");
        throw err.notFound("Route");
      }

      if (auth === "token") {
        grant = await authenticate(req);
        if (!spec.noRateLimit) {
          const rl = await takeConnectorToken(`${grant.grantId}:api`, LIMITS.requestsPerMinute, 60_000);
          headers.set("X-RateLimit-Limit", String(rl.limit));
          headers.set("X-RateLimit-Remaining", String(rl.remaining));
          headers.set("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
          if (!rl.allowed) throw err.rateLimited(Math.max(1, Math.ceil(rl.retryAfterMs / 1000)));
        }
        if (spec.scopes) requireScopes(grant, spec.scopes);
      }

      const maxBody = spec.maxBodyBytes ?? LIMITS.maxBodyBytes;
      let rawBody: Promise<string> | null = null;
      const text = () => (rawBody ??= readLimited(req, maxBody));
      let parsed: { value: unknown } | null = null;
      const json = async () => {
        if (parsed) return parsed.value;
        const t = (await text()).trim();
        let value: unknown;
        if (t) {
          try {
            value = JSON.parse(t);
          } catch {
            throw err.validation("The request body must be valid JSON");
          }
        }
        parsed = { value };
        return value;
      };
      const ignoreUnknown = /(^|[,;\s])unknown-fields=ignore\b/i.test(req.headers.get("prefer") ?? "");

      // a POST that carries an Idempotency-Key is replayed, rejected or run exactly once
      if (grant && spec.idempotent && req.method === "POST") {
        const key = parseIdempotencyKey(req.headers.get("idempotency-key"));
        if (key) {
          const start = await beginIdempotent(grant.grantId, key, requestFingerprint(url.pathname, await json()));
          if (start.kind === "conflict") throw err.idempotencyConflict();
          if (start.kind === "in_progress") throw err.conflict("A request with this Idempotency-Key is still being processed", { "Retry-After": "1" });
          if (start.kind === "replay") {
            headers.set("Idempotent-Replay", "true");
            status = start.status;
            return new Response(start.body, { status, headers });
          }
          idem = { grantId: grant.grantId, key };
        }
      }

      const call: TokenRouteCall<P> = {
        req,
        url,
        params: (routeCtx ? await routeCtx.params : {}) as P,
        requestId,
        ignoreUnknown,
        text,
        json,
        parse: (schema, value) => parseInput(schema, value, ignoreUnknown),
        audit: (name) => {
          auditName = name;
        },
        grant: grant as AuthedGrant,
      };
      const rendered = render(await handler(call), headers);
      status = rendered.status;
      if (idem) {
        if (status < 400) await finishIdempotent(idem.grantId, idem.key, status, rendered.text);
        else await abandonIdempotent(idem.grantId, idem.key);
        idem = null;
      }
      return rendered.response;
    } catch (e) {
      if (idem) await abandonIdempotent(idem.grantId, idem.key).catch(() => undefined);
      const ce = normalizeError(e);
      if (ce.status >= 500) console.error(`[connector] ${requestId} ${req.method} ${spec.route} failed:`, e instanceof Error ? `${e.name}: ${e.message}` : e);
      status = ce.status;
      for (const [k, v] of Object.entries(ce.headers)) headers.set(k, v);
      return new Response(JSON.stringify(errorBody(ce, requestId)), { status: ce.status, headers });
    } finally {
      if (grant) {
        await writeAudit({
          grantId: grant.grantId,
          clientId: grant.clientId,
          workspaceId: grant.workspaceId,
          userId: grant.userId,
          method: req.method,
          route: auditName,
          status,
          requestId,
          durationMs: Date.now() - started,
        }).catch((e) => console.error(`[connector] ${requestId} could not write the audit row:`, e instanceof Error ? e.message : e));
      }
    }
  };
}

/** An endpoint that needs no token (manifest, health, OpenAPI). It still answers 404 when the flag is off. */
export function publicRoute<P = Record<string, never>>(spec: RouteSpec, handler: (c: RouteCall<P>) => Promise<RouteResult>) {
  return build<P>("public", spec, handler as AnyHandler<P>);
}

/** An endpoint that needs a valid access token (and, optionally, scopes). */
export function tokenRoute<P = Record<string, never>>(spec: RouteSpec, handler: (c: TokenRouteCall<P>) => Promise<RouteResult>) {
  return build<P>("token", spec, handler);
}
