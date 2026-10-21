import { normalizeElement } from "@/lib/canvas/normalize";
import type { El } from "@/lib/canvas/types";
import type { WireElementRow } from "@/lib/realtime/protocol";

export interface ChangeMsg {
  full?: boolean;
  cursor: number;
  puts: WireElementRow[];
  dels: string[];
}

interface Row {
  rev: number;
  /** null: the stored JSON is corrupt, skipped so it can never crash the board */
  el: El | null;
}

function parseRow(p: WireElementRow): El | null {
  try {
    const n = normalizeElement(JSON.parse(p.data));
    return n ? { ...n, id: p.eid, z: p.z } : null;
  } catch {
    return null;
  }
}

/**
 * The browser's copy of a board's rows, fed by whichever transport is live: replies to a sync request
 * (the first load, a catch-up after a reconnect, or one HTTP poll) and pushed changes over the WebSocket.
 * Both kinds are idempotent (a row is only taken if its revision is newer), and a pushed change is never
 * undone by a sync reply that was read from the database before it happened.
 */
export class BoardFeed {
  private rows = new Map<string, Row>();
  /** Elements changed by a push since the last sync request went out: their state is newer than the reply's. */
  private fresh = new Set<string>();
  /** Highest change number seen: where the next catch-up starts. */
  cursor = 0;
  loaded = false;

  /** Call right before sending a sync request. */
  beginSync() {
    this.fresh.clear();
  }

  /** A reply to a sync request. `full` means it is the whole board: anything else we hold is gone. Returns true if the board changed. */
  applySync(msg: ChangeMsg): boolean {
    let changed = false;
    if (msg.full) {
      const incoming = new Set(msg.puts.map((p) => p.eid));
      for (const eid of Array.from(this.rows.keys())) {
        if (!incoming.has(eid) && !this.fresh.has(eid)) {
          this.rows.delete(eid);
          changed = true;
        }
      }
    } else {
      for (const eid of msg.dels) if (!this.fresh.has(eid)) changed = this.rows.delete(eid) || changed;
    }
    for (const p of msg.puts) if (!this.fresh.has(p.eid)) changed = this.put(p) || changed;
    this.cursor = Math.max(this.cursor, msg.cursor);
    this.fresh.clear();
    this.loaded = true;
    return changed;
  }

  /** A change pushed by the server. Returns true if the board changed. */
  applyPush(msg: ChangeMsg): boolean {
    let changed = false;
    for (const eid of msg.dels) {
      this.fresh.add(eid);
      changed = this.rows.delete(eid) || changed;
    }
    for (const p of msg.puts) {
      this.fresh.add(p.eid);
      changed = this.put(p) || changed;
    }
    this.cursor = Math.max(this.cursor, msg.cursor);
    return changed;
  }

  private put(p: WireElementRow): boolean {
    const have = this.rows.get(p.eid);
    if (have && have.rev >= p.rev) return false; // already have it (the server re-sends recent rows on purpose) or something newer
    this.rows.set(p.eid, { rev: p.rev, el: parseRow(p) });
    return true;
  }

  get size() {
    return this.rows.size;
  }

  /** Every readable element with its revision, in the shape `DocStore.applyRemote` takes. */
  list(): { el: El; rev: number }[] {
    const out: { el: El; rev: number }[] = [];
    for (const r of this.rows.values()) if (r.el) out.push({ el: r.el, rev: r.rev });
    return out;
  }
}
