import { z } from "zod";
import { isBillingErrorData } from "@/lib/billing/limits";
import { AppError } from "@/lib/server/fn";
import type { Scope } from "./scopes";

/**
 * The CP1 error model. Every failure leaves the connector as
 * `{ "error": { code, message, details?, retryable, requestId, ...extra } }`, never as HTML.
 */

export type ErrorCode =
  | "unauthorized"
  | "insufficient_scope"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "idempotency_conflict"
  | "plan_limit"
  | "precondition_failed"
  | "rate_limited"
  | "upstream_failed"
  | "unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  insufficient_scope: 403,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  idempotency_conflict: 422,
  plan_limit: 402,
  precondition_failed: 412,
  rate_limited: 429,
  upstream_failed: 502,
  unavailable: 503,
  internal: 500,
};

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ConnectErrorOptions {
  status?: number;
  details?: ErrorDetail[];
  /** Extra top-level fields of the error object (`requiredScope`, `limit`, `resetsAt`, `fixUrl`...). */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
  retryable?: boolean;
}

export class ConnectError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, opts: ConnectErrorOptions = {}) {
    super(message);
    this.name = "ConnectError";
    this.code = code;
    this.status = opts.status ?? STATUS[code];
    this.details = opts.details;
    this.extra = opts.extra ?? {};
    this.headers = opts.headers ?? {};
    // only transient conditions are worth retrying as they are
    this.retryable = opts.retryable ?? (this.status === 429 || this.status === 502 || this.status === 503 || this.status >= 500);
  }
}

export const err = {
  unauthorized: (message = "Missing, invalid or expired access token") =>
    new ConnectError("unauthorized", message, { headers: { "WWW-Authenticate": 'Bearer realm="slate-connector"' } }),
  insufficientScope: (requiredScope: Scope | readonly Scope[]) =>
    new ConnectError("insufficient_scope", `This connection was not granted the required scope: ${[requiredScope].flat().join(", ")}`, {
      extra: { requiredScope: Array.isArray(requiredScope) && requiredScope.length === 1 ? requiredScope[0] : requiredScope },
    }),
  forbidden: (message = "You are not allowed to do this") => new ConnectError("forbidden", message),
  /** Also used for ids that belong to another workspace: they must be indistinguishable from missing ones. */
  notFound: (what = "Resource") => new ConnectError("not_found", `${what} not found`),
  validation: (message: string, details?: ErrorDetail[], status = 400) => new ConnectError("validation_failed", message, { details, status }),
  conflict: (message: string, headers?: Record<string, string>) => new ConnectError("conflict", message, { headers }),
  idempotencyConflict: () => new ConnectError("idempotency_conflict", "This Idempotency-Key was already used with a different request"),
  planLimit: (message: string, extra: { limit?: number | null; resetsAt?: string; tier?: string; reason?: string } = {}) => new ConnectError("plan_limit", message, { extra }),
  precondition: (message: string, fixUrl?: string) => new ConnectError("precondition_failed", message, { extra: fixUrl ? { fixUrl } : {} }),
  rateLimited: (retryAfterSeconds: number) =>
    new ConnectError("rate_limited", "Too many requests. Slow down and retry after the indicated time.", { headers: { "Retry-After": String(retryAfterSeconds) }, extra: { retryAfterSeconds } }),
  upstream: (message = "An upstream service failed") => new ConnectError("upstream_failed", message),
  unavailable: (message = "The service is temporarily unavailable") => new ConnectError("unavailable", message),
  internal: () => new ConnectError("internal", "Something went wrong on our side"),
};

export function zodDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

/* ------------------------------------------------------------- mapping what the app throws */

const APP_ERROR_MAP: { test: RegExp; code: ErrorCode; status?: number }[] = [
  { test: /not found|don't have access|no longer exists|was deleted/i, code: "not_found" },
  { test: /only have view access|only workspace members|unauthori[sz]ed|not allowed|can't comment|sign in/i, code: "forbidden" },
  { test: /too large|too many|invalid element id|invalid z-order/i, code: "validation_failed", status: 422 },
];

/**
 * The server functions the connector reuses throw `AppError`s written for people. The connector pre-checks
 * most things itself to give precise codes, so this is the safety net for everything else.
 */
export function fromAppError(e: AppError): ConnectError {
  if (isBillingErrorData(e.data)) {
    const data = e.data as { code: string; message: string; tier: string; limit: number | null };
    const resetsAt = (e.data as { resetsAt?: number }).resetsAt;
    return err.planLimit(data.message, { limit: data.limit, tier: data.tier, reason: data.code, ...(resetsAt ? { resetsAt: new Date(resetsAt).toISOString() } : {}) });
  }
  const hit = APP_ERROR_MAP.find((m) => m.test.test(e.message));
  if (hit?.code === "not_found") return err.notFound(e.message.replace(/ not found$/i, "") || "Resource");
  if (hit?.code === "forbidden") return err.forbidden(e.message);
  return err.validation(e.message, undefined, hit?.status ?? 400);
}

/** Anything thrown while handling a request becomes a ConnectError; unknown failures never leak their message. */
export function normalizeError(e: unknown): ConnectError {
  if (e instanceof ConnectError) return e;
  if (e instanceof z.ZodError) return err.validation("The request is not valid", zodDetails(e));
  if (e instanceof AppError) return fromAppError(e);
  return err.internal();
}

export function errorBody(e: ConnectError, requestId: string) {
  return {
    error: {
      code: e.code,
      message: e.message,
      ...(e.details && e.details.length > 0 ? { details: e.details } : {}),
      retryable: e.retryable,
      requestId,
      ...e.extra,
    },
  };
}
