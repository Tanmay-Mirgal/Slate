import { z } from "zod";
import type { UserDoc } from "@/lib/db/types";

/**
 * The tiny RPC layer that replaces Convex functions. A server function is a validated, access-checked
 * async function: `query` for reads, `mutation` for writes. They are collected in `registry.ts`, called
 * over HTTP by `/api/rpc`, and called directly by the API routes and the tests.
 */

/** An error whose message is meant for the person using the app. Anything else is reported as a generic failure. */
export class AppError extends Error {
  readonly data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "AppError";
    this.data = data;
  }
}

export interface Ctx {
  /** The signed-in Clerk user id, or null for an anonymous visitor. */
  userId: string | null;
  /** The caller's synced profile (name, email, avatar). Loaded on first use, then remembered for the request. */
  profile(): Promise<UserDoc | null>;
  /** Runs `task` after the response was sent (best effort; never fails the request). */
  defer(task: () => Promise<unknown>): void;
}

export type FnKind = "query" | "mutation";

const BRAND = Symbol.for("slate.server-fn");

export interface Fn<A, R, K extends FnKind = FnKind> {
  readonly [BRAND]: true;
  readonly kind: K;
  readonly schema: z.ZodType;
  readonly handler: (ctx: Ctx, args: never) => Promise<R>;
  /** Type-level only. */
  readonly _args?: A;
}

export const isFn = (value: unknown): value is Fn<unknown, unknown> => !!value && typeof value === "object" && (value as Record<symbol, unknown>)[BRAND] === true;

interface Def<S extends z.ZodType, R> {
  args?: S;
  handler: (ctx: Ctx, args: z.output<S>) => Promise<R>;
}

function define<K extends FnKind>(kind: K) {
  return <S extends z.ZodType = z.ZodUndefined, R = unknown>(def: Def<S, R>): Fn<z.input<S>, R, K> =>
    ({ [BRAND]: true, kind, schema: def.args ?? z.unknown(), handler: def.handler as Fn<unknown, R>["handler"] }) as Fn<z.input<S>, R, K>;
}

export const query = define("query");
export const mutation = define("mutation");

/** Validates `raw` against the function's argument schema and runs it. */
export async function invoke<R>(fn: Fn<unknown, R>, ctx: Ctx, raw: unknown): Promise<R> {
  const parsed = fn.schema.safeParse(raw);
  if (!parsed.success) throw new AppError(`Invalid request: ${parsed.error.issues[0]?.message ?? "bad arguments"}`);
  return await fn.handler(ctx, parsed.data as never);
}

/* ------------------------------------------------------------------ shared validators */

/** A document id. Strings only: an object here would be a NoSQL operator injection. */
export const zId = z.string().min(1).max(120);

export const zRole = z.enum(["Admin", "Editor", "Viewer"]);
export const zLinkAccess = z.enum(["none", "view", "edit"]);
