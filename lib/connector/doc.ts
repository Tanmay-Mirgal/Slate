import type { JSONContent } from "@tiptap/core";
import { markdownToTiptapContent } from "@/components/editor/markdown-parser";

/**
 * The document pane stores two fields: `documentText` (Markdown, what search and exports use) and
 * `documentJson` (the editor's own Tiptap document). A write from outside has to produce both, from Markdown.
 */

export interface DocFields {
  documentText: string;
  documentJson: string;
}

/** An empty document, without the editor's "Press '/' for commands" placeholder as if it were content. */
const EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

const toDoc = (markdown: string): JSONContent => (markdown.trim() ? markdownToTiptapContent(markdown) : EMPTY);

export function documentFromMarkdown(markdown: string): DocFields {
  return { documentText: markdown, documentJson: JSON.stringify(toDoc(markdown)) };
}

/**
 * Adds Markdown after what is already there. The existing editor document is kept as it is (callouts, columns
 * and other things Markdown cannot say survive) and the new blocks are appended to it.
 */
export function appendMarkdown(existing: { documentText?: string; documentJson?: string }, markdown: string): DocFields {
  const oldText = (existing.documentText ?? "").trim();
  if (!oldText && !existing.documentJson) return documentFromMarkdown(markdown);

  let base: JSONContent;
  try {
    base = existing.documentJson ? (JSON.parse(existing.documentJson) as JSONContent) : toDoc(oldText);
  } catch {
    base = toDoc(oldText);
  }
  const added = toDoc(markdown).content ?? [];
  const kept = (base.content ?? []).filter((n, i, all) => !(all.length === 1 && n.type === "paragraph" && !n.content)); // drop a lone empty paragraph
  return {
    documentText: [oldText, markdown.trim()].filter(Boolean).join("\n\n"),
    documentJson: JSON.stringify({ type: "doc", content: [...kept, ...added] }),
  };
}
