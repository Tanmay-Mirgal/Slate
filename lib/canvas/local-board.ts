import type { Engine } from "./engine";
import { normalizeMany } from "./normalize";
import type { El, Op } from "./types";

/**
 * Persists a board in localStorage (the public /playground). Same contract as the database sync:
 * the engine hands over batches of ops, this applies them to a map and writes it out, debounced.
 */
export class LocalBoard {
  private saved = new Map<string, El>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  title: string;
  private readonly initial: El[];

  constructor(
    private key: string,
    defaultTitle: string
  ) {
    let title = defaultTitle;
    let els: El[] = [];
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) {
        const data = JSON.parse(raw) as { title?: string; elements?: unknown };
        els = normalizeMany(data.elements);
        if (data.title) title = data.title;
      }
    } catch {
      /* corrupt storage: start fresh */
    }
    this.title = title;
    this.initial = els;
  }

  get hasSavedContent() {
    return this.initial.length > 0;
  }

  /** Loads saved elements (or `fallback()` for a first visit) and starts persisting edits. */
  attach(engine: Engine, fallback: () => El[]) {
    const els = this.initial.length ? this.initial : fallback();
    this.saved = new Map(els.map((e) => [e.id, e]));
    engine.loadElements(els, true);
    engine.setCommit(async (ops: Op[]) => {
      for (const op of ops) {
        if (op.t === "put") this.saved.set(op.el.id, op.el);
        else this.saved.delete(op.id);
      }
      this.schedule(engine);
    });
    this.schedule(engine);
  }

  detach(engine: Engine) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    engine.setCommit(null);
  }

  setTitle(title: string, engine?: Engine) {
    this.title = title;
    this.schedule(engine);
  }

  private schedule(engine?: Engine) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        localStorage.setItem(this.key, JSON.stringify({ title: this.title, elements: Array.from(this.saved.values()) }));
      } catch {
        engine?.toast("Browser storage is full. Export your board to keep it.", "error");
      }
    }, 250);
  }
}
