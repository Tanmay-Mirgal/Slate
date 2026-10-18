"use client";

import * as React from "react";
import { Map as MapIcon, Maximize, Minus, Plus, Redo2, Undo2 } from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { Minimap } from "./Minimap";
import { useUi } from "./hooks";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

function Btn({ title, onClick, disabled, children, active }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "bg-white text-black" : "text-zinc-400 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/** Bottom-left control cluster. `extra` stacks above the zoom row (the cloud-cost badge), so it can never overlap it. */
export function BottomBar({ engine, extra }: { engine: Engine; extra?: React.ReactNode }) {
  const ui = useUi(engine);
  const [mapOpen, setMapOpen] = React.useState(false);

  return (
    <div className="absolute bottom-[76px] left-3 z-30 flex flex-col items-start gap-2 tall:bottom-4 tall:left-4" onPointerDown={(e) => e.stopPropagation()}>
      {mapOpen && <Minimap engine={engine} />}
      {extra}
      <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-[#141416]/85 p-1 shadow-xl backdrop-blur-xl">
        <Btn title={`Undo (${MOD}Z)`} onClick={() => engine.undo()} disabled={!ui.canUndo || ui.readOnly}>
          <Undo2 className="h-4 w-4" />
        </Btn>
        <Btn title={`Redo (${MOD}${isMac ? "⇧Z" : "Y"})`} onClick={() => engine.redo()} disabled={!ui.canRedo || ui.readOnly}>
          <Redo2 className="h-4 w-4" />
        </Btn>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Btn title="Zoom out" onClick={() => engine.zoomBy(1 / 1.25)}>
          <Minus className="h-4 w-4" />
        </Btn>
        <button
          type="button"
          title="Reset to 100%"
          onClick={() => engine.zoomTo(1)}
          className="h-8 min-w-[46px] rounded-lg px-1 text-center text-[12px] font-semibold tabular-nums text-zinc-200 hover:bg-white/10"
        >
          {ui.zoomPct}%
        </button>
        <Btn title="Zoom in" onClick={() => engine.zoomBy(1.25)}>
          <Plus className="h-4 w-4" />
        </Btn>
        <Btn title="Zoom to fit (⇧1)" onClick={() => engine.fitContent()}>
          <Maximize className="h-4 w-4" />
        </Btn>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <Btn title="Minimap" onClick={() => setMapOpen((v) => !v)} active={mapOpen}>
          <MapIcon className="h-4 w-4" />
        </Btn>
      </div>
    </div>
  );
}
