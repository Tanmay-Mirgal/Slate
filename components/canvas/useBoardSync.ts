"use client";

import * as React from "react";
import { api } from "@/lib/client/api";
import { BoardFeed } from "@/lib/client/board-feed";
import { useMutation, useQuery } from "@/lib/client/query";
import { ConnectionLostError } from "@/lib/client/realtime";
import { RpcError, rpcCall } from "@/lib/client/rpc";
import type { Id } from "@/lib/db/types";
import type { Engine } from "@/lib/canvas/engine";
import { legacyToV2 } from "@/lib/canvas/legacy";
import { normalizeElement } from "@/lib/canvas/normalize";
import type { El, LocalPresence, Op, Peer } from "@/lib/canvas/types";
import type { PeerWire } from "@/lib/realtime/protocol";
import type { BoardConnection, PresenceIdentity } from "./useBoardSocket";

export type { PresenceIdentity } from "./useBoardSocket";

export interface SlateAccess {
  access: "edit" | "view";
  legacyElements?: string;
}

const toWire = (op: Op) => (op.t === "put" ? { t: "put" as const, id: op.el.id, z: op.el.z, data: JSON.stringify(op.el) } : { t: "del" as const, id: op.id });

/** HTTP fallback cadence: quick while other people are on the board, relaxed when you are alone. */
const SYNC_MS_WITH_PEERS = 900;
const SYNC_MS_ALONE = 2500;

interface SyncResponse {
  full: boolean;
  cursor: number;
  puts: { eid: string; z: number; rev: number; data: string }[];
  dels: string[];
}

/**
 * Keeps an Engine's document in sync with the database:
 *  - over the WebSocket when it is up: the whole board arrives on join, every later change is pushed as it
 *    happens, and the board's writes go over the same socket;
 *  - over HTTP otherwise (no realtime server, a restart, a blocked network): polls for changes since the last
 *    answer and writes through `elements.apply`. The two share one set of rows (`BoardFeed`), so switching
 *    between them in either direction loses nothing.
 *  - uploads images to `/api/files`
 *  - migrates schema-v1 boards (one JSON string) into per-element rows the first time an editor opens them
 */
export function useBoardSync(engine: Engine, slateId: Id<"slates">, slate: SlateAccess | null | undefined, forceReadOnly: boolean, conn: BoardConnection): { ready: boolean } {
  const apply = useMutation(api.elements.apply);
  const importLegacy = useMutation(api.elements.importLegacy);

  const enabled = !!slate;
  const legacyView = !!slate?.legacyElements;
  const [ready, setReady] = React.useState(false);
  const kick = React.useRef<() => void>(() => undefined);
  const socketRef = React.useRef(conn.socket);
  React.useEffect(() => {
    socketRef.current = conn.socket;
  }, [conn.socket]);

  // read-only follows the server's verdict, optionally tightened by ?mode=view
  React.useEffect(() => {
    engine.setReadOnly(forceReadOnly || slate?.access === "view" || !slate);
  }, [engine, forceReadOnly, slate]);

  // writes
  React.useEffect(() => {
    if (!enabled) return;
    engine.setCommit(async (ops) => {
      const wire = ops.map(toWire);
      const socket = socketRef.current;
      if (socket?.isOpen) {
        try {
          await socket.sendOps(wire);
          return;
        } catch (e) {
          if (!(e instanceof ConnectionLostError)) throw e; // a real refusal (no rights, too large): the editor shows it
          // the connection dropped mid-write: send the same batch over HTTP (writing an element twice is harmless)
        }
      }
      await apply({ slateId, ops: wire });
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
    const socket = conn.socket;
    const feed = new BoardFeed();
    let alive = true;
    let first = true;

    const show = (changed: boolean) => {
      if (!alive) return;
      if (changed || first) engine.store.applyRemote(feed.list(), true);
      if (first) {
        first = false;
        engine.initialFit();
        setReady(true);
      }
    };

    /* ---- HTTP polling: runs only while the socket is not open ---- */
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let inflight = false;
    let again = false;
    let failures = 0;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = polling && alive ? setTimeout(() => void tick(), ms) : null;
    };
    const tick = async () => {
      if (!alive || !polling) return;
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
        feed.beginSync();
        const res = await rpcCall<SyncResponse>(api.elements.sync.name, { slateId, since: feed.cursor });
        if (!alive) return;
        failures = 0;
        show(feed.applySync(res));
      } catch (e) {
        if (!alive) return;
        failures += 1;
        delay = Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));
        if (failures === 3 && e instanceof RpcError) engine.toast("Having trouble reaching the server. Retrying…", "error");
      } finally {
        inflight = false;
        schedule(again ? 0 : delay);
      }
    };
    const startPolling = () => {
      if (polling) return;
      polling = true;
      schedule(0);
    };
    const stopPolling = () => {
      polling = false;
      if (timer) clearTimeout(timer);
      timer = null;
    };
    kick.current = () => {
      if (polling) schedule(0);
    };
    const onVisible = () => document.visibilityState === "visible" && polling && schedule(0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    /* ---- WebSocket: the board on join, then every change pushed ---- */
    const offSocket = socket?.subscribe({
      status: (status) => (status === "open" ? stopPolling() : startPolling()),
      sync: (msg) => show(feed.applySync(msg)),
      elements: (msg) => show(feed.applyPush(msg)),
    });
    if (socket) {
      // a (re)join asks the server for what we are missing since the last row we saw
      socket.setSinceProvider(() => {
        feed.beginSync();
        return feed.cursor;
      });
    }
    if (socket?.isOpen) {
      // the socket joined before this board was ready to listen: ask again
      feed.beginSync();
      socket.requestSync(feed.cursor);
    } else {
      startPolling();
    }

    return () => {
      alive = false;
      polling = false;
      if (timer) clearTimeout(timer);
      offSocket?.();
      socket?.setSinceProvider(() => 0);
      kick.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [engine, slateId, enabled, legacyView, conn.socket]);

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

const STALE_MS = 45_000;

/** A person on the board as the canvas wants them (the draft arrives as JSON text). */
function peerFromWire(r: PeerWire): Peer {
  let draft: El | null = null;
  if (r.draft) {
    try {
      draft = normalizeElement(JSON.parse(r.draft));
    } catch {
      draft = null;
    }
  }
  return {
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
  };
}

/**
 * Live cursors, selections, in-progress shapes and drag previews. Over the WebSocket they are relayed
 * between the people on the board and never touch the database; over HTTP (fallback) each tab keeps a
 * short-lived row that the others poll.
 */
export function useBoardPresence(engine: Engine, slateId: Id<"slates">, enabled: boolean, who: PresenceIdentity, conn: BoardConnection) {
  const join = useMutation(api.presence.join);
  const update = useMutation(api.presence.update);
  const wsOpen = conn.status === "open";
  const raw = useQuery(api.presence.list, enabled && !wsOpen ? { slateId } : "skip");

  const { sessionId, color } = conn;
  const rowId = React.useRef<Id<"liveSessions"> | null>(null);
  const [tick, setTick] = React.useState(0);

  /* ---- over the WebSocket ---- */
  React.useEffect(() => {
    const socket = conn.socket;
    if (!enabled || !socket || !wsOpen) return;
    engine.setPresenceChannel({
      send: (p: LocalPresence) =>
        socket.sendPresence({ cursor: p.cursor, selection: p.selection, draft: p.draft ? JSON.stringify(p.draft) : undefined, drag: p.drag ?? undefined, tool: p.tool }),
    });
    const show = (list: PeerWire[]) => engine.setPeers(list.filter((r) => r.sessionId !== sessionId).map(peerFromWire));
    show(socket.peers());
    const off = socket.subscribe({ peers: show });
    const onVisible = () => document.visibilityState === "visible" && engine.schedulePresence();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      engine.setPresenceChannel(null);
      engine.setPeers([]);
    };
  }, [engine, enabled, wsOpen, conn.socket, sessionId]);

  /* ---- over HTTP (when the socket is not up) ---- */
  React.useEffect(() => {
    if (!enabled || wsOpen) return;
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
  }, [engine, enabled, wsOpen, slateId, sessionId, who.name, who.avatar, color, join, update]);

  // The HTTP answer only changes when a peer does something, so freshness is judged on our own clock:
  // a session whose `lastSeen` stops changing for STALE_MS is treated as gone.
  const seen = React.useRef(new Map<string, { lastSeen: number; at: number }>());
  React.useEffect(() => {
    if (!enabled || wsOpen) return;
    const now = Date.now();
    const peers: Peer[] = [];
    for (const r of raw ?? []) {
      if (r.sessionId === sessionId) continue;
      const s = seen.current.get(r.sessionId);
      if (!s || s.lastSeen !== r.lastSeen) seen.current.set(r.sessionId, { lastSeen: r.lastSeen, at: now });
      const at = seen.current.get(r.sessionId)!.at;
      if (now - at > STALE_MS) continue;
      peers.push(peerFromWire(r));
    }
    engine.setPeers(peers);
  }, [engine, enabled, wsOpen, raw, sessionId, tick]);
}
