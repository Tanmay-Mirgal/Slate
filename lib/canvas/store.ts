import { elementRect, type RouteScene } from "./router";
import { rectsIntersect } from "./geometry";
import type { El, Op, Rect } from "./types";

export type SyncState = "saved" | "saving" | "error";

interface Tx {
  before: Map<string, El | null>;
  after: Map<string, El | null>;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

const HISTORY_LIMIT = 300;
const FLUSH_DELAY = 40;
const ACK_GRACE_MS = 2000;
const CHUNK = 200;

/**
 * Local document state.
 *
 *  - Elements are immutable: every change replaces the object, so history can hold references.
 *  - Local edits are grouped into gestures (begin/end); one gesture == one undo step and one
 *    batched write to the backend.
 *  - Undo/redo only touch the elements the user changed, so they never clobber collaborators'
 *    edits to other elements.
 *  - Remote snapshots never overwrite elements that are mid-gesture, queued or in flight.
 */
export class DocStore implements RouteScene {
  readonly els = new Map<string, El>();
  version = 0;
  /** Bumps when node geometry changes (drives connector re-routing). */
  geomVersion = 0;
  readOnly = false;
  syncState: SyncState = "saved";
  syncError: string | null = null;
  commit: ((ops: Op[]) => Promise<void>) | null = null;

  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();
  private undoStack: Tx[] = [];
  private redoStack: Tx[] = [];
  private capture: Map<string, El | null> | null = null;
  private depth = 0;

  private dirty = new Map<string, El | null>();
  private inflight = new Set<string>();
  private acked = new Map<string, number>();
  private revs = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private retries = 0;

  private sorted: El[] | null = null;
  private nodeIndex: { rect: Rect; id: string }[] | null = null;
  private nodeIndexVersion = -1;

  /* ------------------------------------------------------------ subscription */

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeSync(fn: () => void): () => void {
    this.syncListeners.add(fn);
    return () => this.syncListeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setSync(state: SyncState, error: string | null = null) {
    if (this.syncState === state && this.syncError === error) return;
    this.syncState = state;
    this.syncError = error;
    for (const fn of this.syncListeners) fn();
  }

  /* ------------------------------------------------------------------ reads */

  get(id: string): El | undefined {
    return this.els.get(id);
  }

  /** Elements in paint order (cached until the next structural / z change). */
  list(): El[] {
    if (!this.sorted) {
      this.sorted = Array.from(this.els.values()).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    }
    return this.sorted;
  }

  get size() {
    return this.els.size;
  }

  maxZ(): number {
    const l = this.list();
    return l.length ? l[l.length - 1].z : 0;
  }

  minZ(): number {
    const l = this.list();
    return l.length ? l[0].z : 0;
  }

  nextZ(): number {
    return this.maxZ() + 1;
  }

  obstacles(near: Rect): Rect[] {
    if (!this.nodeIndex || this.nodeIndexVersion !== this.geomVersion) {
      this.nodeIndex = [];
      for (const el of this.els.values()) {
        if (el.type === "connector" || el.type === "frame" || el.type === "pen") continue;
        this.nodeIndex.push({ id: el.id, rect: elementRect(el) });
      }
      this.nodeIndexVersion = this.geomVersion;
    }
    const out: Rect[] = [];
    for (const n of this.nodeIndex) if (rectsIntersect(n.rect, near)) out.push(n.rect);
    return out;
  }

  /* ------------------------------------------------------------- mutations */

  begin() {
    if (this.depth++ === 0) this.capture = new Map();
  }

  end() {
    if (this.depth === 0) return;
    if (--this.depth > 0) return;
    const cap = this.capture!;
    this.capture = null;

    const before = new Map<string, El | null>();
    const after = new Map<string, El | null>();
    for (const [id, prev] of cap) {
      const cur = this.els.get(id) ?? null;
      if (!deepEqual(prev, cur)) {
        before.set(id, prev);
        after.set(id, cur);
      }
    }
    if (before.size === 0) return;
    this.undoStack.push({ before, after });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    for (const [id, el] of after) this.dirty.set(id, el);
    this.scheduleFlush();
    this.emit();
  }

  /** Commits any gestures left open (e.g. an unmounted text editor). */
  closeGestures() {
    while (this.depth > 0) this.end();
  }

  /** Runs `fn` as a single undoable, single-write unit. */
  transact<T>(fn: () => T): T {
    this.begin();
    try {
      return fn();
    } finally {
      this.end();
    }
  }

  private touch(id: string) {
    if (this.capture && !this.capture.has(id)) this.capture.set(id, this.els.get(id) ?? null);
  }

  private indexInSorted(el: El): number {
    const arr = this.sorted!;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const m = arr[mid];
      const cmp = m.z - el.z || (m.id < el.id ? -1 : m.id > el.id ? 1 : 0);
      if (cmp === 0) return mid;
      if (cmp < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private afterChange(prev: El | undefined, next: El | undefined) {
    this.version++;
    const ref = next ?? prev;
    if (!ref) return;
    if (this.sorted) {
      if (prev && next && prev.z === next.z) {
        // Same paint position: swap the new object into the cached order instead of re-sorting.
        const i = this.indexInSorted(prev);
        if (i >= 0) this.sorted[i] = next;
        else this.sorted = null;
      } else this.sorted = null;
    }
    if (ref.type !== "connector" && ref.type !== "pen") {
      if (!prev || !next || prev.x !== next.x || prev.y !== next.y || prev.w !== next.w || prev.h !== next.h || prev.angle !== next.angle) {
        this.geomVersion++;
      }
    }
  }

  put(el: El) {
    if (this.readOnly) return;
    this.begin();
    this.touch(el.id);
    const prev = this.els.get(el.id);
    this.els.set(el.id, el);
    this.afterChange(prev, el);
    this.end();
    if (this.depth > 0) this.emit();
  }

  putMany(list: El[]) {
    if (this.readOnly) return;
    this.transact(() => {
      for (const el of list) {
        this.touch(el.id);
        const prev = this.els.get(el.id);
        this.els.set(el.id, el);
        this.afterChange(prev, el);
      }
    });
  }

  patch(id: string, partial: Partial<El>) {
    if (this.readOnly) return;
    const prev = this.els.get(id);
    if (!prev) return;
    this.begin();
    this.touch(id);
    const next = { ...prev, ...partial } as El;
    this.els.set(id, next);
    this.afterChange(prev, next);
    this.end();
    if (this.depth > 0) this.emit();
  }

  /** Applies `fn` to every id inside one gesture; emits once. */
  patchMany(ids: Iterable<string>, fn: (el: El) => Partial<El> | null) {
    if (this.readOnly) return;
    this.begin();
    let changed = false;
    for (const id of ids) {
      const prev = this.els.get(id);
      if (!prev) continue;
      const partial = fn(prev);
      if (!partial) continue;
      this.touch(id);
      const next = { ...prev, ...partial } as El;
      this.els.set(id, next);
      this.afterChange(prev, next);
      changed = true;
    }
    this.end();
    if (changed && this.depth > 0) this.emit();
  }

  remove(id: string) {
    this.removeMany([id]);
  }

  removeMany(ids: Iterable<string>) {
    if (this.readOnly) return;
    this.begin();
    let changed = false;
    for (const id of ids) {
      const prev = this.els.get(id);
      if (!prev) continue;
      this.touch(id);
      this.els.delete(id);
      this.afterChange(prev, undefined);
      changed = true;
    }
    this.end();
    if (changed && this.depth > 0) this.emit();
  }

  /* --------------------------------------------------------------- history */

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(): string[] | null {
    if (this.readOnly) return null;
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.redoStack.push(tx);
    return this.applyStates(tx.before);
  }

  redo(): string[] | null {
    if (this.readOnly) return null;
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.undoStack.push(tx);
    return this.applyStates(tx.after);
  }

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  private applyStates(states: Map<string, El | null>): string[] {
    const ids: string[] = [];
    for (const [id, el] of states) {
      const prev = this.els.get(id);
      if (el) this.els.set(id, el);
      else this.els.delete(id);
      this.afterChange(prev, el ?? undefined);
      this.dirty.set(id, el);
      if (el) ids.push(id);
    }
    this.scheduleFlush();
    this.emit();
    return ids;
  }

  /* ----------------------------------------------------------------- remote */

  private isProtected(id: string): boolean {
    if (this.capture?.has(id)) return true;
    if (this.dirty.has(id) || this.inflight.has(id)) return true;
    const at = this.acked.get(id);
    if (at !== undefined) {
      if (Date.now() - at < ACK_GRACE_MS) return true;
      this.acked.delete(id);
    }
    return false;
  }

  /**
   * Reconciles server rows into local state. `complete` means `rows` is the entire document, so
   * missing ids are deletions. Returns true if anything changed.
   */
  applyRemote(rows: { el: El; rev: number }[], complete = true): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const { el, rev } of rows) {
      seen.add(el.id);
      if (this.isProtected(el.id)) continue;
      if (this.revs.get(el.id) === rev && this.els.has(el.id)) continue;
      this.revs.set(el.id, rev);
      const prev = this.els.get(el.id);
      if (prev && deepEqual(prev, el)) continue;
      this.els.set(el.id, el);
      this.afterChange(prev, el);
      changed = true;
    }
    if (complete) {
      for (const id of Array.from(this.els.keys())) {
        if (seen.has(id) || !this.revs.has(id) || this.isProtected(id)) continue;
        const prev = this.els.get(id);
        this.els.delete(id);
        this.revs.delete(id);
        this.afterChange(prev, undefined);
        changed = true;
      }
    }
    if (changed) this.emit();
    return changed;
  }

  /** Replace everything without touching history or the outbound queue (initial load / import). */
  load(list: El[]) {
    this.els.clear();
    this.dirty.clear();
    this.revs.clear();
    for (const el of list) this.els.set(el.id, el);
    this.sorted = null;
    this.version++;
    this.geomVersion++;
    this.clearHistory();
    this.emit();
  }

  /* ------------------------------------------------------------------- sync */

  hasPending(): boolean {
    return this.dirty.size > 0 || this.inflight.size > 0 || this.flushing;
  }

  private scheduleFlush(delay = FLUSH_DELAY) {
    if (!this.commit || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    const commit = this.commit;
    if (!commit || this.flushing || this.dirty.size === 0) return;
    this.flushing = true;
    this.setSync("saving");
    const batch = new Map(this.dirty);
    this.dirty.clear();
    for (const id of batch.keys()) this.inflight.add(id);
    const ops: Op[] = Array.from(batch, ([id, el]) => (el ? { t: "put", el } : { t: "del", id }));
    try {
      for (let i = 0; i < ops.length; i += CHUNK) await commit(ops.slice(i, i + CHUNK));
      const now = Date.now();
      for (const id of batch.keys()) {
        this.inflight.delete(id);
        this.acked.set(id, now);
      }
      this.retries = 0;
      this.flushing = false;
      if (this.dirty.size) this.scheduleFlush(0);
      else this.setSync("saved");
    } catch (err) {
      for (const [id, el] of batch) {
        this.inflight.delete(id);
        if (!this.dirty.has(id)) this.dirty.set(id, el);
      }
      this.flushing = false;
      this.retries++;
      this.setSync("error", err instanceof Error ? err.message : "Could not save changes");
      this.scheduleFlush(Math.min(15000, 1000 * 2 ** Math.min(this.retries, 4)));
    }
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.listeners.clear();
    this.syncListeners.clear();
  }
}
