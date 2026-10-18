"use client";

import * as React from "react";
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { markdownToTiptapContent, tiptapContentToMarkdown } from "./markdown-parser";

export interface DocStats {
  words: number;
  minutes: number;
  ready: boolean;
  editable: boolean;
}

const EMPTY: DocStats = { words: 0, minutes: 0, ready: false, editable: false };
const WORDS_PER_MINUTE = 220;
/** What a brand new document contains; it counts as "empty" so generated docs replace it. */
const PLACEHOLDER = "Press '/' for commands";

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function statsFor(words: number, ready: boolean, editable: boolean): DocStats {
  return { words, minutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)), ready, editable };
}

/**
 * Lets the canvas side of the app talk to the Tiptap editor on the other side of the split view
 * (word count, copy markdown, drop in a diagram snapshot or generated documentation) without the
 * two sharing React state. The editor registers itself; work requested while it isn't mounted yet
 * (for example switching from canvas-only to split view) is queued and run as soon as it appears.
 */
export class DocBridge {
  private editor: Editor | null = null;
  private stats: DocStats = EMPTY;
  private listeners = new Set<() => void>();
  private queue: { fn: (editor: Editor) => void; expires: number }[] = [];
  private detachEditor: (() => void) | null = null;

  /** Registers (or clears, with null) the live editor. Called by the editor component. */
  attach(editor: Editor | null) {
    this.detachEditor?.();
    this.detachEditor = null;
    this.editor = editor && !editor.isDestroyed ? editor : null;
    if (this.editor) {
      const ed = this.editor;
      const refresh = () => this.refresh();
      ed.on("update", refresh);
      this.detachEditor = () => ed.off("update", refresh);
    }
    this.refresh();
    // Queued work runs after the current commit's effects: the editor component resets its content
    // to the saved document in an effect of its own, which would otherwise wipe what was just inserted.
    if (this.editor) queueMicrotask(() => this.flush());
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getStats = (): DocStats => this.stats;

  get current(): Editor | null {
    return this.editor;
  }

  private refresh() {
    const ed = this.editor;
    const next = ed ? statsFor(countWords(ed.getText()), true, ed.isEditable) : EMPTY;
    const prev = this.stats;
    if (prev.words === next.words && prev.minutes === next.minutes && prev.ready === next.ready && prev.editable === next.editable) return;
    this.stats = next;
    for (const fn of this.listeners) fn();
  }

  private flush() {
    const ed = this.editor;
    if (!ed || ed.isDestroyed) return;
    const now = Date.now();
    const jobs = this.queue.splice(0);
    for (const job of jobs) if (job.expires > now) job.fn(ed);
  }

  /** Runs `fn` against the editor now, or as soon as one is attached (jobs expire after `ttlMs`). */
  run(fn: (editor: Editor) => void, ttlMs = 15_000) {
    if (this.editor) fn(this.editor);
    else this.queue.push({ fn, expires: Date.now() + ttlMs });
  }

  markdown(): string {
    return this.editor ? tiptapContentToMarkdown(this.editor.getJSON()) : "";
  }

  isEmpty(): boolean {
    const ed = this.editor;
    if (!ed) return true;
    const text = ed.getText().trim();
    return text === "" || text === PLACEHOLDER;
  }

  /** Appends a picture (and an optional caption line) at the end of the document. */
  insertImage(image: { src: string; alt: string }, caption?: string) {
    this.run((ed) => {
      const content: JSONContent[] = [{ type: "paragraph", content: [{ type: "image", attrs: { src: image.src, alt: image.alt } }] }];
      if (caption) content.push({ type: "paragraph", content: [{ type: "text", text: caption, marks: [{ type: "italic" }] }] });
      ed.chain().focus("end").insertContentAt(ed.state.doc.content.size, content).run();
    });
  }

  /**
   * Writes markdown into the document: replaces a blank document, otherwise appends below a divider.
   * Returns false when the editor is read-only.
   */
  insertMarkdown(md: string, opts: { mode?: "append" | "replace-if-empty" } = {}): boolean {
    let written = true;
    this.run((ed) => {
      if (!ed.isEditable) {
        written = false;
        return;
      }
      const doc = markdownToTiptapContent(md);
      const content = doc.content ?? [];
      if ((opts.mode ?? "replace-if-empty") === "replace-if-empty" && this.isEmpty()) {
        ed.chain().setContent({ type: "doc", content }, { emitUpdate: true }).run();
      } else {
        ed.chain()
          .focus("end")
          .insertContentAt(ed.state.doc.content.size, [{ type: "horizontalRule" }, ...content])
          .run();
      }
    });
    return written;
  }
}

/** Live word count / reading time for the document header. */
export function useDocStats(bridge: DocBridge | undefined): DocStats {
  const subscribe = React.useCallback((cb: () => void) => (bridge ? bridge.subscribe(cb) : () => undefined), [bridge]);
  const get = React.useCallback(() => (bridge ? bridge.getStats() : EMPTY), [bridge]);
  return React.useSyncExternalStore(subscribe, get, () => EMPTY);
}

export function useDocBridge(): DocBridge {
  const [bridge] = React.useState(() => new DocBridge());
  return bridge;
}
