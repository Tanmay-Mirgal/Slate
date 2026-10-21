import * as billing from "./billing";
import * as comments from "./comments";
import * as elements from "./elements";
import { isFn, type Fn, type FnKind } from "./fn";
import * as presence from "./presence";
import * as slates from "./slates";
import * as users from "./users";
import * as versions from "./versions";
import * as workspaces from "./workspaces";

/**
 * Every function the browser may call through `/api/rpc`, grouped by module. Anything a module
 * exports that is not a `query` / `mutation` (helpers, server-only operations) is invisible to the
 * network: only values created by `query()` / `mutation()` are looked up here.
 */
export const functions = { billing, comments, elements, presence, slates, users, versions, workspaces };

export type Functions = typeof functions;

/** `"slates.list"` -> the function, or undefined. Own properties only, so `"constructor.x"` can't be reached. */
export function lookup(name: string): Fn<unknown, unknown> | undefined {
  const [mod, fn, ...rest] = name.split(".");
  if (!mod || !fn || rest.length > 0) return undefined;
  if (!Object.prototype.hasOwnProperty.call(functions, mod)) return undefined;
  const group = functions[mod as keyof Functions] as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(group, fn)) return undefined;
  const candidate = group[fn];
  return isFn(candidate) ? candidate : undefined;
}

/* ---- type-level API description for the client (`lib/client/api.ts`) ---- */

export interface FnRef<K extends FnKind, A, R> {
  readonly name: string;
  readonly _kind?: K;
  readonly _args?: A;
  readonly _result?: R;
}

type RefOf<F> = F extends Fn<infer A, infer R, infer K> ? FnRef<K, A, Awaited<R>> : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = Fn<any, any, FnKind>;

export type Api = {
  [M in keyof Functions]: {
    [F in keyof Functions[M] as Functions[M][F] extends AnyFn ? F : never]: RefOf<Functions[M][F]>;
  };
};
