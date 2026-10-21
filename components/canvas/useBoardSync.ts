"use client";

import * as React from "react";
import { api } from "@/lib/client/api";
import { useMutation, useQuery } from "@/lib/client/query";
import { RpcError, rpcCall } from "@/lib/client/rpc";
import type { Id } from "@/lib/db/types";
import type { Engine } from "@/lib/canvas/engine";
import { legacyToV2 } from "@/lib/canvas/legacy";
import { newId } from "@/lib/canvas/ids";
import { normalizeElement } from "@/lib/canvas/normalize";
import { colorFor } from "@/lib/canvas/peers";
import type { El, LocalPresence, Op, Peer } from "@/lib/canvas/types";

export interface SlateAccess {
  access: "edit" | "view";
  legacyElements?: string;
}

const toWire = (op: Op) => (op.t === "put" ? { t: "put" as const, id: op.el.id, z: op.el.z, data: JSON.stringify(op.el) } : { t: "del" as const, id: op.id });

/** How often the board is re-read: quick while other people are on it, relaxed when you are alone. */
const SYNC_MS_WITH_PEERS = 900;
const SYNC_MS_ALONE = 2500;

interface SyncResponse {
  full: boolean;
  cursor: number;
  puts: { eid: string; z: number; rev: number; data: string }[];
  dels: string[];
}

interface Row {
  rev: number;
  z: number;
  /** null: the stored JSON is corrupt, skipped so it can never crash the board */
  el: El | null;
}

function parseRow(eid: string, z: number, data: string): El | null {
  try {
    const n = normalizeElement(JSON.parse(data));
    return n ? { ...n, id: eid, z } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps an Engine's document in sync with the database:
 *  - polls the board for changes since the last answer (a delta, not the whole board) and reconciles them into the local store
 *  - batches local edits into `elements.apply` calls, then re-reads straight away
 *  - uploads images to `/api/files`
 *  - migrates schema-v1 boards (one JSON string) into per-element rows the first time an editor opens them
 */
export function useBoardSync(engine: Engine, slateId: Id<"slates">, slate: SlateAccess | null | undefined, forceReadOnly: boolean): { ready: boolean } {
  const apply = useMutation(api.elements.apply);
  const importLegacy = useMutation(api.elements.importLegacy);

  const enabled = !!slate;
  const legacyView = !!slate?.legacyElements;
  const [ready, setReady] = React.useState(false);
  const kick = React.useRef<() => void>(() => undefined);

  // read-only follows the server's verdict, optionally tightened by ?mode=view
  React.useEffect(() => {
    engine.setReadOnly(forceReadOnly || slate?.access === "view" || !slate);
  }, [engine, forceReadOnly, slate]);

  // writes
  React.useEffect(() => {
    if (!enabled) return;
    engine.setCommit(async (ops) => {
      await apply({ slateId, ops: ops.map(toWire) });
      kick.current(); // fetch the authoritative rows right away instead of waiting for the next poll
    });
    engine.configure({
      imageUploader: async (blob) => {
        let res: Response;
        try {
          res = await fetch(`/api/files?slateId=${encodeURIComponent(slateId)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob, credentials: "same-origin" });
        } catch {
          throw new Error("Image upload failed. Check your connection and try again.");
        }
        const result = (await res.json().catch(() => null)) as { ok: true; url: string } | { ok: false; error: string } | null;
        if (!result?.ok) throw new Error(result?.error ?? "Image upload failed");
        return result.url;
      },
    });
    return () => {
      engine.setCommit(null);
      engine.configure({ imageUploader: null });
    };
  }, [engine, enabled, slateId, apply]);

  // reads
  React.useEffect(() => {
    if (!enabled || legacyView) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight = false;
    let again = false;
    let cursor = 0;
    let failures = 0;
    let first = true;
    const rows = new Map<string, Row>();

    const reconcile = (res: SyncResponse): boolean => {
      let changed = false;
      if (res.full) {
        // the complete board: anything we hold that is not in it is gone
        const incoming = new Set(res.puts.map((p) => p.eid));
        for (const eid of Array.from(rows.keys())) {
          if (!incoming.has(eid)) {
            rows.delete(eid);
            changed = true;
          }
        }
      } else {
        for (const eid of res.dels) changed = rows.delete(eid) || changed;
      }
      for (const p of res.puts) {
        const have = rows.get(p.eid);
        if (have && have.rev === p.rev) continue; // the 5 s overlap window re-sends recent rows; we already have them
        rows.set(p.eid, { rev: p.rev, z: p.z, el: parseRow(p.eid, p.z, p.data) });
        changed = true;
      }
      return changed;
    };

    const tick = async () => {
      if (!alive) return;
      if (inflight) {
        again = true;
        return;
      }
      if (document.visibilityState === "hidden" && !first) {
        schedule(SYNC_MS_ALONE);
        return;
      }
      inflight = true;
      again = false;
      let delay = engine.peers.length > 0 ? SYNC_MS_WITH_PEERS : SYNC_MS_ALONE;
      try {
        const res = await rpcCall<SyncResponse>(api.elements.sync.name, { slateId, since: cursor });
        if (!alive) return;
        failures = 0;
        cursor = res.cursor;
        const changed = reconcile(res);
        if (changed || first) {
          const list: { el: El; rev: number }[] = [];
          for (const r of rows.values()) if (r.el) list.push({ el: r.el, rev: r.rev });
          engine.store.applyRemote(list, true);
        }
        if (first) {
          first = false;
          engine.initialFit();
          setReady(true);
        }
      } catch (e) {
        if (!alive) return;
        failures += 1;
        delay = Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));
        if (failures === 3 && e instanceof RpcError) engine.toast("Having trouble reaching the server. Retrying…", "error");
      } finally {
        inflight = false;
        if (alive) schedule(again ? 0 : delay);
      }
    };

    function schedule(ms: number) {
      if (timer) clearTimeout(timer);
      timer = alive ? setTimeout(() => void tick(), ms) : null;
    }

    kick.current = () => schedule(0);
    const onVisible = () => document.visibilityState === "visible" && schedule(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    void tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      kick.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [engine, slateId, enabled, legacyView]);

  // schema-v1 boards: show immediately, persist once if the user can edit
  const migrating = React.useRef(false);
  React.useEffect(() => {
    if (!slate?.legacyElements || migrating.current) return;
    migrating.current = true;
    let list: unknown;
    try {
      list = JSON.parse(slate.legacyElements);
    } catch {
      list = [];
    }
    const { elements, skipped } = legacyToV2(list);
    engine.store.load(elements);
    engine.initialFit();
    if (slate.access === "edit" && !forceReadOnly) {
      const ops: Op[] = elements.map((el) => ({ t: "put", el }));
      importLegacy({ slateId, ops: ops.map(toWire) })
        .then(() => engine.toast(skipped ? `Upgraded your board (${skipped} unsupported items were skipped)` : "Your board was upgraded to the new canvas"))
        .catch(() => {
          migrating.current = false;
          engine.toast("Couldn't upgrade this board yet — will retry", "error");
        });
    }
  }, [engine, slate, slateId, forceReadOnly, importLegacy]);

  // True once the board has arrived (and, for legacy boards, once it has been loaded locally), so callers
  // can act on the complete board instead of racing the first snapshot. Effects of later hooks run after the
  // reconcile above, so the store is already populated when this flips.
  return { ready: enabled && (legacyView || ready) };
}

/* ------------------------------------------------------------------ presence */

export interface PresenceIdentity {
  userId: string | null;
  name: string;
  avatar?: string;
}

const STALE_MS = 45_000;

export function useBoardPresence(engine: Engine, slateId: Id<"slates">, enabled: boolean, who: PresenceIdentity) {
  const join = useMutation(api.presence.join);
  const update = useMutation(api.presence.update);
  const raw = useQuery(api.presence.list, enabled ? { slateId } : "skip");

  const sessionId = React.useMemo(() => newId("t"), []);
  const color = React.useMemo(() => colorFor(who.userId ?? sessionId), [who.userId, sessionId]);
  const rowId = React.useRef<Id<"liveSessions"> | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let inflight = false;
    let pending: LocalPresence | null = null;
    let lastSent = 0;
    let joining: Promise<void> | null = null;

    const doJoin = () => {
      if (joining) return joining;
      joining = join({ slateId, sessionId, name: who.name, avatar: who.avatar, color })
        .then((id) => {
          rowId.current = id;
        })
        .catch(() => {
          rowId.current = null;
        })
        .finally(() => {
          joining = null;
        });
      return joining;
    };

    const send = (p: LocalPresence) => {
      const id = rowId.current;
      if (!id) {
        void doJoin().then(() => alive && rowId.current && send(p));
        return;
      }
      if (inflight) {
        pending = p; // coalesce: only the newest state is worth sending
        return;
      }
      inflight = true;
      lastSent = Date.now();
      update({
        id,
        cursor: p.cursor,
        selection: p.selection,
        draft: p.draft ? JSON.stringify(p.draft) : undefined,
        drag: p.drag ?? undefined,
        tool: p.tool,
      })
        .then((ok) => {
          if (!ok) {
            rowId.current = null;
            void doJoin();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inflight = false;
          if (pending && alive) {
            const next = pending;
            pending = null;
            send(next);
          }
        });
    };

    // `keepalive` lets the request finish while the page is being closed
    const leave = () => {
      const id = rowId.current;
      if (id) void rpcCall(api.presence.leave.name, { id }, { keepalive: true }).catch(() => undefined);
    };

    void doJoin();
    engine.setPresenceChannel({ send });

    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastSent > 15_000) engine.schedulePresence();
    }, 5000);
    const sweep = setInterval(() => setTick((t) => t + 1), 10_000);
    const onVisible = () => document.visibilityState === "visible" && engine.schedulePresence();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", leave);

    return () => {
      alive = false;
      clearInterval(heartbeat);
      clearInterval(sweep);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", leave);
      engine.setPresenceChannel(null);
      engine.setPeers([]);
      leave();
      rowId.current = null;
    };
    // identity changes (sign-in) re-join with the right name
  }, [engine, enabled, slateId, sessionId, who.name, who.avatar, color, join, update]);

  // The answer only changes when a peer does something, so freshness is judged on our own clock:
  // a session whose `lastSeen` value stops changing for STALE_MS is treated as gone.
  const seen = React.useRef(new Map<string, { lastSeen: number; at: number }>());
  React.useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const peers: Peer[] = [];
    for (const r of raw ?? []) {
      if (r.sessionId === sessionId) continue;
      const s = seen.current.get(r.sessionId);
      if (!s || s.lastSeen !== r.lastSeen) seen.current.set(r.sessionId, { lastSeen: r.lastSeen, at: now });
      const at = seen.current.get(r.sessionId)!.at;
      if (now - at > STALE_MS) continue;
      let draft: El | null = null;
      if (r.draft) {
        try {
          draft = normalizeElement(JSON.parse(r.draft));
        } catch {
          draft = null;
        }
      }
      peers.push({
        sessionId: r.sessionId,
        userId: r.userId,
        name: r.name,
        avatar: r.avatar,
        color: r.color,
        cursor: r.cursor,
        selection: r.selection,
        draft,
        drag: r.drag ?? null,
        tool: r.tool as Peer["tool"],
        lastSeen: r.lastSeen,
      });
    }
    engine.setPeers(peers);
  }, [engine, enabled, raw, sessionId, tick]);
}
