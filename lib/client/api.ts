import type { Api } from "@/lib/server/registry";

export type { FnRef } from "@/lib/server/registry";

/**
 * Typed references to the server functions: `api.slates.list`, `api.workspaces.create`, ...
 * Only the *types* come from the server modules (`import type` is erased), so none of the database
 * code reaches the browser bundle. At runtime a reference is just `{ name: "slates.list" }`.
 */
export const api = new Proxy({} as Api, {
  get: (_t, mod: string) => new Proxy({}, { get: (_t2, fn: string) => ({ name: `${mod}.${fn}` }) }),
});
