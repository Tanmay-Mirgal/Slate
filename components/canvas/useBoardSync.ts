"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SHARD_COUNT } from "@/convex/shards";
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

/**
 * Keeps an Engine's document in sync with Convex:
 *  - subscribes to every shard of the slate's elements and reconciles them into the local store
 *  - batches local edits into `elements.apply` calls
 *  - uploads images to Convex storage
 *  - migrates schema-v1 boards (one JSON string) into per-element rows the first time an editor opens them
 */
export function useBoardSync(engine: Engine, slateId: Id<"slates">, slate: SlateAccess | null | undefined, forceReadOnly: boolean): { ready: boolean } {
  const apply = useMutation(api.elements.apply);
  const importLegacy = useMutation(api.elements.importLegacy);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const finalizeImage = useMutation(api.files.finalizeImage);

  const enabled = !!slate;
  const legacyView = !!slate?.legacyElements;

  const shardArgs = (n: number) => (enabled && !legacyView ? { slateId, shard: n } : "skip");
  const s0 = useQuery(api.elements.list, shardArgs(0));
  const s1 = useQuery(api.elements.list, shardArgs(1));
  const s2 = useQuery(api.elements.list, shardArgs(2));
  const s3 = useQuery(api.elements.list, shardArgs(3));
  if (SHARD_COUNT !== 4) throw new Error("useBoardSync subscribes to exactly 4 shards; update it together with SHARD_COUNT");

  // read-only follows the server's verdict, optionally tightened by ?mode=view
  React.useEffect(() => {
    engine.setReadOnly(forceReadOnly || slate?.access === "view" || !slate);
  }, [engine, forceReadOnly, slate]);

  // writes
  React.useEffect(() => {
    if (!enabled) return;
    engine.setCommit(async (ops) => {
      await apply({ slateId, ops: ops.map(toWire) });
    });
    engine.configure({
      imageUploader: async (blob) => {
        const url = await generateUploadUrl({ slateId });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
        if (!res.ok) throw new Error("Image upload failed");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const result = await finalizeImage({ slateId, storageId });
        if (!result.ok) throw new Error(result.error);
        return result.url;
      },
    });
    return () => {
      engine.setCommit(null);
      engine.configure({ imageUploader: null });
    };
  }, [engine, enabled, slateId, apply, generateUploadUrl, finalizeImage]);

  // reads
  const parsed = React.useRef(new Map<string, { rev: number; el: El | null }>());
  const first = React.useRef(true);
  React.useEffect(() => {
    if (!enabled || legacyView) return;
    const shards = [s0, s1, s2, s3];
    if (shards.some((s) => s === undefined)) return;
    const rows: { el: El; rev: number }[] = [];
    const cache = parsed.current;
    for (const shard of shards) {
      for (const r of shard!) {
        let c = cache.get(r.eid);
        if (!c || c.rev !== r.rev) {
          let el: El | null = null;
          try {
            const n = normalizeElement(JSON.parse(r.data));
            if (n) el = { ...n, id: r.eid, z: r.z };
          } catch {
            /* corrupt row: skipped, never crashes the board */
          }
          c = { rev: r.rev, el };
          cache.set(r.eid, c);
        }
        if (c.el) rows.push({ el: c.el, rev: r.rev });
      }
    }
    engine.store.applyRemote(rows, true);
    if (first.current) {
      first.current = false;
      engine.initialFit();
    }
  }, [engine, enabled, legacyView, s0, s1, s2, s3]);

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

  // True once every shard has arrived (and, for legacy boards, once they've been loaded locally), so callers
  // can act on the complete board instead of racing the first snapshot. Effects of later hooks run after the
  // reconcile effect above, so the store is already populated when this flips.
  const ready = enabled && (legacyView || (s0 !== undefined && s1 !== undefined && s2 !== undefined && s3 !== undefined));
  return { ready };
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
  const leave = useMutation(api.presence.leave);
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

    void doJoin();
    engine.setPresenceChannel({ send });

    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastSent > 15_000) engine.schedulePresence();
    }, 5000);
    const sweep = setInterval(() => setTick((t) => t + 1), 10_000);
    const onVisible = () => document.visibilityState === "visible" && engine.schedulePresence();
    const onHide = () => {
      if (rowId.current) void leave({ id: rowId.current });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);

    return () => {
      alive = false;
      clearInterval(heartbeat);
      clearInterval(sweep);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
      engine.setPresenceChannel(null);
      engine.setPeers([]);
      if (rowId.current) void leave({ id: rowId.current });
      rowId.current = null;
    };
    // identity changes (sign-in) re-join with the right name
  }, [engine, enabled, slateId, sessionId, who.name, who.avatar, color, join, update, leave]);

  // Convex only re-runs the query when data changes, so freshness is judged on our own clock:
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
