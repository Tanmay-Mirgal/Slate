"use client";

import * as React from "react";
import { Check, Clock, Copy, Download, ImagePlus, Loader2 } from "lucide-react";
import type { DocBridge } from "@/components/editor/doc-bridge";
import { useDocStats } from "@/components/editor/doc-bridge";
import type { Engine } from "@/lib/canvas/engine";
import { downloadBlob, safeFilename } from "@/lib/canvas/export";
import { BoardTitle } from "./BoardTitle";

interface DocHeaderProps {
  engine: Engine;
  title: string;
  onRename?: (title: string) => void;
  backHref: string;
  bridge: DocBridge;
  onInsertSnapshot: () => void;
  snapshotBusy: boolean;
}

function HeaderButton({ title, label, onClick, disabled, children }: { title: string; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      <span className="@max-2xl:hidden">{label}</span>
    </button>
  );
}

/**
 * Reading header for the document pane in split view: title and save state on the left, word count
 * and reading time, then the document actions. The canvas controls live in the canvas pane's own header.
 */
export function DocHeader({ engine, title, onRename, backHref, bridge, onInsertSnapshot, snapshotBusy }: DocHeaderProps) {
  const stats = useDocStats(bridge);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => (copyTimer.current ? clearTimeout(copyTimer.current) : undefined), []);

  const copyMarkdown = async () => {
    const md = bridge.markdown();
    if (!md.trim()) {
      engine.toast("The document is empty", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      engine.toast("Couldn't access the clipboard. Use Download .md instead.", "error");
    }
  };

  const downloadMarkdown = () => {
    const md = bridge.markdown();
    if (!md.trim()) {
      engine.toast("The document is empty", "info");
      return;
    }
    downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), safeFilename(title, "md"));
  };

  return (
    <header className="@container flex h-14 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-white/10 bg-[#0c0c0e] px-3">
      <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden">
        <BoardTitle engine={engine} title={title} onRename={onRename} backHref={backHref} compact />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <span
          className="mr-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-400 @max-md:hidden"
          title={`${stats.words.toLocaleString()} words`}
        >
          <Clock className="h-3 w-3" />
          {stats.ready ? (
            <>
              {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
              <span className="text-zinc-600">·</span>
              {stats.minutes === 0 ? "No reading time" : `${stats.minutes} min read`}
            </>
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </span>
        <HeaderButton title="Copy document as Markdown" label={copied ? "Copied" : "Copy Markdown"} onClick={() => void copyMarkdown()} disabled={!stats.ready}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </HeaderButton>
        <HeaderButton title="Download as .md" label=".md" onClick={downloadMarkdown} disabled={!stats.ready}>
          <Download className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton title="Insert a snapshot of the canvas (or the selection) into this document" label="Insert diagram" onClick={onInsertSnapshot} disabled={!stats.ready || !stats.editable || snapshotBusy}>
          {snapshotBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        </HeaderButton>
      </div>
    </header>
  );
}
