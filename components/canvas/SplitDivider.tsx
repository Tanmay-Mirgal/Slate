"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { SPLIT_MAX, SPLIT_MIN, SPLIT_PRESETS } from "@/lib/canvas/split";

interface SplitDividerProps {
  ratio: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onSet: (ratio: number) => void;
  onReset: () => void;
  onCollapseDoc: () => void;
  onCollapseCanvas: () => void;
}

const pill = "flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-semibold transition-colors";

/**
 * The seam between the document and the canvas: a 1px hairline with a wider invisible hit area,
 * a grip that lights up on hover, and a pill of layout presets that appears above the grip.
 */
export function SplitDivider({ ratio, dragging, onPointerDown, onSet, onReset, onCollapseDoc, onCollapseCanvas }: SplitDividerProps) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    // The canvas also listens for arrow keys (to pan), so handled keys must not bubble up to it.
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      onSet(ratio - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      onSet(ratio + step);
    } else if (e.key === "Enter" || e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      onReset();
    }
  };

  return (
    <div className="group relative z-[45] w-px shrink-0 bg-white/10" data-slate-ui>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize document and canvas"
        aria-valuemin={SPLIT_MIN}
        aria-valuemax={SPLIT_MAX}
        aria-valuenow={Math.round(ratio)}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        className="peer absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none"
      />
      {/* highlight line */}
      <div className={`pointer-events-none absolute inset-y-0 -left-px w-[3px] transition-colors ${dragging ? "bg-primary/70" : "bg-transparent group-hover:bg-primary/30 peer-focus-visible:bg-primary/50"}`} />
      {/* grip */}
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 z-20 flex h-11 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-all ${
          dragging
            ? "border-transparent bg-primary text-primary-foreground shadow-[0_0_16px_rgba(255,255,255,0.45)]"
            : "border-white/10 bg-[#1b1b1f] text-zinc-500 group-hover:border-transparent group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-[0_0_14px_rgba(255,255,255,0.35)]"
        }`}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      {/* presets */}
      <div
        className={`pointer-events-none absolute bottom-[calc(50%+22px)] left-1/2 z-20 -translate-x-1/2 pb-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${dragging ? "!opacity-0" : ""}`}
      >
        <div className="flex items-center gap-0.5 whitespace-nowrap rounded-xl border border-white/10 bg-[#141416]/95 p-1 shadow-2xl backdrop-blur-xl">
          <button type="button" onClick={onCollapseDoc} title="Collapse document (canvas only)" aria-label="Collapse document" className={`${pill} w-7 px-0 text-zinc-400 hover:bg-white/10 hover:text-white`}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {SPLIT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSet(p.ratio)}
              aria-pressed={Math.round(ratio) === p.ratio}
              className={`${pill} ${Math.round(ratio) === p.ratio ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10 hover:text-white"}`}
            >
              {p.label}
            </button>
          ))}
          <button type="button" onClick={onCollapseCanvas} title="Collapse canvas (document only)" aria-label="Collapse canvas" className={`${pill} w-7 px-0 text-zinc-400 hover:bg-white/10 hover:text-white`}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
