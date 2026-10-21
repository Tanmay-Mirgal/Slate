"use client";

import * as React from "react";
import type { FnRef } from "./api";
import { RpcError, rpcCall } from "./rpc";

/*
 * A small data layer in the spirit of Convex's `useQuery` / `useMutation`, over plain HTTP:
 *
 *  - every distinct (function, arguments) pair is fetched once and shared by all components using it
 *  - active queries are re-fetched on a timer (per-function interval below), when the tab becomes visible again,
 *    when the network comes back, and immediately after any mutation
 *  - polling pauses while the tab is hidden
 */

/** How often an active query refreshes, in ms (0 = fetched once). Anything not listed uses DEFAULT_POLL_MS. */
const POLL_MS: Record<string, number> = {
  "presence.list": 1000,
  "presence.activeOnSlates": 5000,
  "comments.list": 3000,
  "comments.messages": 3000,
  "comments.members": 30_000,
  "slates.getById": 5000,
  "slates.getDocument": 0,
  "slates.list": 6000,
  "slates.listShared": 10_000,
  "slates.listSharedByMe": 10_000,
  "workspaces.listMyWorkspaces": 15_000,
  "workspaces.listMembers": 15_000,
  "workspaces.listPendingInvites": 15_000,
  "workspaces.getMyPendingInvites": 10_000,
  "billing.getMyBilling": 30_000,
};
const DEFAULT_POLL_MS = 10_000;

/** Mutations that never change what any query shows, so they don't trigger a refresh (cursors are sent many times a second). */
const NO_INVALIDATE = new Set(["presence.join", "presence.update", "presence.leave", "elements.apply", "elements.importLegacy", "slates.reportStats", "slates.updateDocument"]);

/** Queries a page cannot work without: after repeated failures they throw, so the page's error boundary shows. */
const CRITICAL = new Set(["slates.getById", "slates.getDocument"]);

const IDLE_KEEP_MS = 5 * 60_000;

interface Snapshot {
  data: unknown;
  error: RpcError | null;
}

interface Entry {
  name: string;
  args: unknown;
  json: string | null;
  snap: Snapshot;
  hasData: boolean;
  failures: number;
  fetchedAt: number;
  observers: number;
  inflight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  idleSince: number;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
let epoch = 0; // bumped when the signed-in user changes, so answers fetched for the old user are dropped

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : v)) ?? "";
}

const pollFor = (name: string) => POLL_MS[name] ?? DEFAULT_POLL_MS;
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function emit(e: Entry) {
  for (const l of e.listeners) l();
}

function schedule(e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  const base = pollFor(e.name);
  if (e.observers === 0 || base === 0) return;
  const delay = e.failures > 0 ? Math.min(30_000, base * 2 ** Math.min(e.failures, 4)) : base;
  e.timer = setTimeout(() => void refresh(e), delay);
}

async function refresh(e: Entry): Promise<void> {
  if (e.inflight || e.observers === 0) return;
  if (hidden() && e.hasData) {
    schedule(e); // paused: check again later, fetch as soon as the tab is visible
    return;
  }
  e.inflight = true;
  const startedIn = epoch;
  try {
    const data = await rpcCall<unknown>(e.name, e.args);
    if (startedIn !== epoch) return;
    const json = JSON.stringify(data) ?? "";
    e.failures = 0;
    e.fetchedAt = Date.now();
    // an unchanged answer keeps the previous snapshot, so consumers' effects and memos don't re-run on every poll
    if (!e.hasData || json !== e.json || e.snap.error) {
      e.json = json;
      e.hasData = true;
      e.snap = { data, error: null };
      emit(e);
    }
  } catch (err) {
    if (startedIn !== epoch) return;
    e.failures += 1;
    const error = err instanceof RpcError ? err : new RpcError(err instanceof Error ? err.message : "Request failed");
    if (CRITICAL.has(e.name) && !e.hasData && e.failures >= 3) {
      e.snap = { data: undefined, error };
      emit(e);
    }
  } finally {
    e.inflight = false;
    schedule(e);
  }
}

function entryFor(name: string, args: unknown): Entry {
  const key = `${name}|${stable(args)}`;
  let e = entries.get(key);
  if (!e) {
    e = { name, args, json: null, snap: { data: undefined, error: null }, hasData: false, failures: 0, fetchedAt: 0, observers: 0, inflight: false, timer: null, idleSince: Date.now(), listeners: new Set() };
    entries.set(key, e);
    if (entries.size > 200) sweep();
  }
  return e;
}

function sweep() {
  const now = Date.now();
  for (const [key, e] of entries) if (e.observers === 0 && now - e.idleSince > IDLE_KEEP_MS) entries.delete(key);
}

function attach(e: Entry, listener: () => void): () => void {
  e.listeners.add(listener);
  e.observers += 1;
  installGlobalListeners();
  // a component mounting right after another one used the same query reuses its fresh answer
  if (!e.hasData || Date.now() - e.fetchedAt > 800) void refresh(e);
  else schedule(e);
  return () => {
    e.listeners.delete(listener);
    e.observers -= 1;
    if (e.observers === 0) {
      e.idleSince = Date.now();
      if (e.timer) clearTimeout(e.timer);
      e.timer = null;
    }
  };
}

/** Re-fetches every query that is currently on screen. */
export function refetchActiveQueries(): void {
  for (const e of entries.values()) {
    if (e.observers > 0) void refresh(e);
  }
}

let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
function invalidateSoon() {
  if (invalidateTimer) return; // several mutations in a row share one refresh
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    refetchActiveQueries();
  }, 30);
}

/** Forget everything: the signed-in user changed, so cached answers belong to somebody else. */
export function resetQueryCache(): void {
  epoch += 1;
  for (const e of entries.values()) {
    e.json = null;
    e.hasData = false;
    e.fetchedAt = 0;
    e.failures = 0;
    e.inflight = false;
    e.snap = { data: undefined, error: null };
    emit(e);
  }
  refetchActiveQueries();
}

let installed = false;
function installGlobalListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const wake = () => {
    if (!hidden()) refetchActiveQueries();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
}

/* --------------------------------------------------------------------- hooks */

type ArgsParam<A> = undefined extends A ? [args?: A | "skip"] : [args: A | "skip"];

/** The result of a server query, or `undefined` while it loads (or when args are `"skip"`). Refreshes on its own. */
export function useQuery<A, R>(ref: FnRef<"query", A, R>, ...rest: ArgsParam<A>): R | undefined {
  const args = rest[0];
  const argKey = args === "skip" ? null : stable(args);
  // the entry is looked up by (name, args); two renders with equal args share it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = React.useMemo(() => (argKey === null ? null : entryFor(ref.name, args)), [ref.name, argKey]);
  const subscribe = React.useCallback((listener: () => void) => (entry ? attach(entry, listener) : () => undefined), [entry]);
  const getSnapshot = React.useCallback(() => entry?.snap ?? EMPTY, [entry]);
  const snap = React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  if (snap.error) throw snap.error;
  return snap.data as R | undefined;
}

const EMPTY: Snapshot = { data: undefined, error: null };

/** Returns a function that calls a server mutation. Active queries refresh right after it succeeds. */
export function useMutation<A, R>(ref: FnRef<"mutation", A, R>): (...args: ArgsParam<A>) => Promise<R> {
  const name = ref.name;
  return React.useCallback(
    async (...rest: ArgsParam<A>) => {
      const args = rest[0] === "skip" ? undefined : rest[0];
      const result = await rpcCall<R>(name, args);
      if (!NO_INVALIDATE.has(name)) invalidateSoon();
      return result;
    },
    [name]
  );
}

/** Calls a query or mutation once, outside React (the mutation refresh rule still applies). */
export async function callFn<A, R>(ref: FnRef<"query" | "mutation", A, R>, ...rest: ArgsParam<A>): Promise<R> {
  const args = rest[0] === "skip" ? undefined : rest[0];
  const result = await rpcCall<R>(ref.name, args);
  if (!NO_INVALIDATE.has(ref.name)) invalidateSoon();
  return result;
}
