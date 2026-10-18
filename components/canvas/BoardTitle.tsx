"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, CloudOff, Eye, Loader2 } from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { useUi } from "./hooks";

interface BoardTitleProps {
  engine: Engine;
  title: string;
  onRename?: (title: string) => void;
  backHref: string;
  /** Hide the save-state text and shrink the title (used inside narrow panes). */
  compact?: boolean;
}

/** Logo (back to the dashboard), renameable title and save indicator: shared by the top bar and the document header. */
export function BoardTitle({ engine, title, onRename, backHref, compact }: BoardTitleProps) {
  const ui = useUi(engine);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);

  const commitTitle = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== title) onRename?.(t);
    else setDraft(title);
  };

  return (
    <>
      <Link href={backHref} className="flex shrink-0 items-center" title="Back to dashboard">
        <Image src="/logo.svg" alt="Slate" width={28} height={28} className="rounded-lg" />
      </Link>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTitle();
            if (e.key === "Escape") {
              setDraft(title);
              setEditing(false);
            }
          }}
          maxLength={120}
          className={`rounded-md border border-white/20 bg-black/40 px-2 py-1 text-[13px] font-semibold text-white outline-none ${compact ? "w-32" : "w-44"}`}
        />
      ) : (
        <button
          type="button"
          disabled={!onRename || ui.readOnly}
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
          title={onRename && !ui.readOnly ? "Rename" : undefined}
          className={`truncate rounded-md px-1.5 py-1 text-[13px] font-semibold text-white enabled:hover:bg-white/10 ${compact ? "max-w-[120px]" : "max-w-[200px]"} max-md:max-w-[110px]`}
        >
          {title || "Untitled"}
        </button>
      )}
      {ui.readOnly ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-300">
          <Eye className="h-3 w-3" /> View only
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-2.5 text-[11px] font-medium" title={ui.syncError ?? undefined}>
          {ui.sync === "saving" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
              <span className="text-zinc-400 max-sm:hidden">Saving…</span>
            </>
          ) : ui.sync === "error" ? (
            <>
              <CloudOff className="h-3 w-3 text-amber-400" />
              <span className="text-amber-400 max-sm:hidden">Offline · retrying</span>
            </>
          ) : (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-zinc-500 max-sm:hidden">Saved</span>
            </>
          )}
        </span>
      )}
    </>
  );
}
