import { z } from "zod";
import type { AuthedGrant } from "../auth/verify";
import type { ConnectError } from "../errors";
import type { Scope } from "../scopes";

/**
 * The registry is the single source of truth for what the connector can do. Each action, resource and event is
 * declared once here with zod schemas; request validation, the manifest, the OpenAPI document and the docs are
 * all generated from these declarations, so they cannot drift apart.
 */

export interface RequestInfo {
  requestId: string;
  /** `Prefer: unknown-fields=ignore` was sent. */
  ignoreUnknown: boolean;
}

export interface ActionContext extends RequestInfo {
  grant: AuthedGrant;
}

interface ActionBase {
  /** `boards.create` */
  name: string;
  title: string;
  description: string;
  /** Every one of these scopes is required. */
  scopes: readonly Scope[];
  /** Safe to repeat with the same Idempotency-Key. */
  idempotent: boolean;
  input: z.ZodType;
  output: z.ZodType;
}

/** Answers in the HTTP response: `200 { output }`. */
export interface SyncActionDef extends ActionBase {
  async: false;
  handler: (c: ActionContext, input: unknown) => Promise<unknown>;
}

/**
 * Answers `202 { operation }` and finishes in the background. `accept` runs while the request is open (check
 * everything that can be checked, take AI credits) and returns what `run` needs; `run` produces the output.
 */
export interface AsyncActionDef extends ActionBase {
  async: true;
  accept: (c: ActionContext, input: unknown) => Promise<{ state: Record<string, unknown>; creditsReserved?: number }>;
  run: (c: OperationRunContext, input: unknown, state: Record<string, unknown>) => Promise<unknown>;
  /** Called once when `run` failed (after the credits were handed back), e.g. to send a `...failed` event. Never throws into the caller. */
  onFailure?: (c: OperationRunContext, input: unknown, state: Record<string, unknown>, error: ConnectError) => Promise<void>;
}

export interface OperationRunContext {
  grant: AuthedGrant;
  operationId: string;
  requestId: string;
  signal?: AbortSignal;
}

export type ActionDef = SyncActionDef | AsyncActionDef;

export function defineSyncAction<I extends z.ZodType, O extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  scopes: readonly Scope[];
  idempotent?: boolean;
  input: I;
  output: O;
  handler: (c: ActionContext, input: z.output<I>) => Promise<z.input<O>>;
}): SyncActionDef {
  return { ...def, async: false, idempotent: def.idempotent ?? true, handler: (c, input) => def.handler(c, input as z.output<I>) };
}

export function defineAsyncAction<I extends z.ZodType, O extends z.ZodType, S extends Record<string, unknown>>(def: {
  name: string;
  title: string;
  description: string;
  scopes: readonly Scope[];
  idempotent?: boolean;
  input: I;
  output: O;
  accept: (c: ActionContext, input: z.output<I>) => Promise<{ state: S; creditsReserved?: number }>;
  run: (c: OperationRunContext, input: z.output<I>, state: S) => Promise<z.input<O>>;
  onFailure?: (c: OperationRunContext, input: z.output<I>, state: S, error: ConnectError) => Promise<void>;
}): AsyncActionDef {
  const { onFailure, ...rest } = def;
  return {
    ...rest,
    async: true,
    idempotent: def.idempotent ?? true,
    accept: (c, input) => def.accept(c, input as z.output<I>),
    run: (c, input, state) => def.run(c, input as z.output<I>, state as S),
    ...(onFailure ? { onFailure: (c: OperationRunContext, input: unknown, state: Record<string, unknown>, error: ConnectError) => onFailure(c, input as z.output<I>, state as S, error) } : {}),
  };
}

export interface ResourceContext extends RequestInfo {
  grant: AuthedGrant;
  /** `{id}` segments of the path. */
  params: Record<string, string>;
}

export interface ResourceDef {
  /** `boards.list` */
  name: string;
  method: "GET";
  /** Relative to /api/connect/v1, with `{param}` segments: `/boards/{id}/document`. */
  path: string;
  scopes: readonly Scope[];
  description: string;
  query: z.ZodType;
  output: z.ZodType;
  handler: (c: ResourceContext, query: unknown) => Promise<unknown>;
}

export function defineResource<Q extends z.ZodType, O extends z.ZodType>(def: {
  name: string;
  path: string;
  scopes: readonly Scope[];
  description: string;
  query: Q;
  output: O;
  handler: (c: ResourceContext, query: z.output<Q>) => Promise<z.input<O>>;
}): ResourceDef {
  return { ...def, method: "GET", handler: (c, query) => def.handler(c, query as z.output<Q>) };
}

export interface EventDef {
  /** `board.approved` */
  type: string;
  description: string;
  /** The grant needs these to receive the event (it must also be allowed to read the entity). */
  scopes: readonly Scope[];
  data: z.ZodType;
}

export const defineEvent = (def: EventDef): EventDef => def;

export interface Registry {
  actions: readonly ActionDef[];
  resources: readonly ResourceDef[];
  events: readonly EventDef[];
}

/** `/boards/{id}/document` -> a matcher that extracts `{ id }`. */
export function compilePath(path: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split("/")
    .map((segment) => {
      const m = /^\{(\w+)\}$/.exec(segment);
      if (m) {
        keys.push(m[1]);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export function matchResource(resources: readonly ResourceDef[], path: string): { resource: ResourceDef; params: Record<string, string> } | null {
  for (const resource of resources) {
    const { regex, keys } = compilePath(resource.path);
    const m = regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => {
      try {
        params[k] = decodeURIComponent(m[i + 1]);
      } catch {
        params[k] = m[i + 1];
      }
    });
    return { resource, params };
  }
  return null;
}
