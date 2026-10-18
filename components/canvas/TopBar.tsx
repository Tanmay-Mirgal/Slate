"use client";

import * as React from "react";
import {
  Check,
  Code2,
  Download,
  FileJson,
  GraduationCap,
  Grid3x3,
  ImagePlus,
  Keyboard,
  Magnet,
  Maximize,
  Maximize2,
  Menu,
  Minus,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { parseBoardFile } from "@/lib/canvas/export";
import { insertElements } from "@/lib/canvas/commands";
import type { GridKind } from "@/lib/canvas/types";
import { BoardTitle } from "./BoardTitle";
import { useUi } from "./hooks";

export type ViewMode = "canvas" | "document" | "split";

/** "full" spans the whole window; "canvas" lives inside the canvas pane of the split view (the document pane has its own header). */
export type TopBarSection = "full" | "canvas";

interface TopBarProps {
  engine: Engine;
  title: string;
  onRename?: (title: string) => void;
  backHref: string;
  mode: ViewMode;
  onMode?: (m: ViewMode) => void;
  onOpenExport: () => void;
  onOpenShortcuts: () => void;
  onOpenCommand?: () => void;
  onOpenCode?: () => void;
  onToggleAi?: () => void;
  aiOpen?: boolean;
  onPresent: () => void;
  actions?: React.ReactNode;
  aiLocked?: boolean;
  section?: TopBarSection;
  /** Writes a snapshot of the selection (or board) into the document. */
  onInsertSnapshot?: () => void;
  onToggleInterview?: () => void;
  interviewOn?: boolean;
}

function MenuItem({ icon: Icon, label, onClick, checked, danger, hint }: { icon: React.ElementType; label: string; onClick: () => void; checked?: boolean; danger?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-200 hover:bg-white/10"}`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      {checked && <Check className="h-3.5 w-3.5 text-indigo-400" />}
    </button>
  );
}

export function TopBar({ engine, title, onRename, backHref, mode, onMode, onOpenExport, onOpenShortcuts, onOpenCommand, onOpenCode, onToggleAi, aiOpen, onPresent, actions, aiLocked, section = "full", onInsertSnapshot, onToggleInterview, interviewOn }: TopBarProps) {
  const ui = useUi(engine);
  const [menu, setMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const inPane = section === "canvas";

  React.useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [menu]);

  const setGrid = (g: GridKind) => engine.setView({ grid: g });
  const theme = ui.view.theme;
  const shown = ui.peers.slice(0, 4);
  const extra = ui.peers.length - shown.length;

  const importFile = async (file: File) => {
    try {
      const els = parseBoardFile(await file.text());
      if (els.length === 0) throw new Error("The file has no elements");
      insertElements(engine, els, { at: "free" });
      engine.toast(`Imported ${els.length} elements`);
    } catch (err) {
      engine.toast(err instanceof Error ? err.message : "Could not read that file", "error");
    }
  };

  // Labels collapse by viewport in full width, by the pane's own width when it sits inside the split view.
  const hideLabel = inPane ? "@max-2xl:hidden" : "max-md:hidden";

  const modeSwitch = onMode && (
    <div
      className={`pointer-events-auto items-center gap-0.5 rounded-2xl border border-white/10 bg-[#141416]/85 p-1 shadow-xl backdrop-blur-xl ${
        inPane ? "flex" : "absolute left-1/2 top-3 hidden -translate-x-1/2 md:flex"
      }`}
    >
      {(["canvas", "split", "document"] as ViewMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onMode(m)}
          className={`rounded-xl px-3.5 py-1.5 text-[12px] font-semibold capitalize transition-colors ${inPane ? "@max-md:px-2.5" : ""} ${mode === m ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
        >
          {m === "document" ? "Doc" : m}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start gap-3 p-3 max-md:p-2 ${inPane ? "@container flex-wrap justify-between" : "justify-between"}`}>
      {/* left cluster */}
      {!inPane && (
        <div className="pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-[#141416]/85 py-1.5 pl-2 pr-3 shadow-xl backdrop-blur-xl">
          <BoardTitle engine={engine} title={title} onRename={onRename} backHref={backHref} />
        </div>
      )}

      {/* mode switch */}
      {modeSwitch}

      {/* right cluster */}
      <div className={`pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#141416]/85 p-1.5 shadow-xl backdrop-blur-xl ${inPane ? "ml-auto" : ""}`}>
        {inPane && (
          <div className="flex items-center gap-0.5 @max-3xl:hidden" aria-label="Zoom controls">
            <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => engine.zoomBy(1 / 1.25)} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" title="Reset to 100%" onClick={() => engine.zoomTo(1)} className="h-8 min-w-[44px] rounded-lg px-1 text-center text-[12px] font-semibold tabular-nums text-zinc-200 hover:bg-white/10">
              {ui.zoomPct}%
            </button>
            <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => engine.zoomBy(1.25)} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
              <Plus className="h-4 w-4" />
            </button>
            <button type="button" title="Zoom to fit (⇧1)" aria-label="Zoom to fit" onClick={() => engine.fitContent()} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
              <Maximize className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-white/10" />
          </div>
        )}
        {ui.peers.length > 0 && (
          <div className={`flex items-center pl-1 pr-1.5 ${inPane ? "@max-xl:hidden" : ""}`} title={ui.peers.map((p) => p.name).join(", ")}>
            <div className="flex -space-x-2">
              {shown.map((p) => (
                <div
                  key={p.sessionId}
                  className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-[#141416] text-[11px] font-bold uppercase text-white"
                  style={{ background: p.color }}
                >
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    p.name.charAt(0)
                  )}
                </div>
              ))}
              {extra > 0 && <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#141416] bg-zinc-700 text-[10px] font-bold text-white">+{extra}</div>}
            </div>
          </div>
        )}
        {onOpenCommand && (
          <button type="button" onClick={onOpenCommand} title="Search & commands" className={`flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-white ${inPane ? "@max-3xl:hidden" : "max-md:hidden"}`}>
            <Search className="h-3.5 w-3.5" />
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
          </button>
        )}
        {onToggleAi && (
          <button
            type="button"
            onClick={onToggleAi}
            title={aiLocked ? "Sign in to use Slate AI" : "Generate diagrams with AI"}
            className={`flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all ${aiOpen ? "bg-white text-black" : "bg-gradient-to-r from-indigo-500/90 to-fuchsia-500/90 text-white hover:brightness-110"}`}
          >
            <Sparkles className="h-3.5 w-3.5" /> <span className={inPane ? "@max-xl:hidden" : ""}>AI</span>
          </button>
        )}
        {actions}
        <button type="button" onClick={onOpenExport} title="Export" className={`flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/10 ${inPane ? "@max-xl:hidden" : ""}`}>
          <Download className="h-3.5 w-3.5" />
          <span className={hideLabel}>Export</span>
        </button>
        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setMenu((m) => !m)} title="Menu" className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${menu ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10"}`}>
            <Menu className="h-4 w-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-white/10 bg-[#141416]/95 p-1.5 shadow-2xl backdrop-blur-xl">
              <MenuItem icon={theme === "dark" ? Sun : Moon} label={theme === "dark" ? "Light canvas" : "Dark canvas"} onClick={() => engine.setView({ theme: theme === "dark" ? "light" : "dark" })} />
              <div className="my-1 h-px bg-white/10" />
              <MenuItem icon={Grid3x3} label="Dot grid" checked={ui.view.grid === "dots"} onClick={() => setGrid("dots")} />
              <MenuItem icon={Grid3x3} label="Line grid" checked={ui.view.grid === "lines"} onClick={() => setGrid("lines")} />
              <MenuItem icon={Grid3x3} label="No grid" checked={ui.view.grid === "none"} onClick={() => setGrid("none")} />
              <MenuItem icon={Magnet} label="Snap to grid" checked={ui.view.snapToGrid} onClick={() => engine.setView({ snapToGrid: !ui.view.snapToGrid })} />
              <MenuItem icon={Magnet} label="Snap to objects" checked={ui.view.snapToObjects} onClick={() => engine.setView({ snapToObjects: !ui.view.snapToObjects })} />
              <div className="my-1 h-px bg-white/10" />
              <MenuItem
                icon={Upload}
                label="Import board (.json)"
                onClick={() => {
                  setMenu(false);
                  fileRef.current?.click();
                }}
              />
              <MenuItem
                icon={FileJson}
                label="Export as…"
                onClick={() => {
                  setMenu(false);
                  onOpenExport();
                }}
              />
              {onInsertSnapshot && !ui.readOnly && (
                <MenuItem
                  icon={ImagePlus}
                  label="Insert snapshot into document"
                  onClick={() => {
                    setMenu(false);
                    onInsertSnapshot();
                  }}
                />
              )}
              {onToggleInterview && (
                <MenuItem
                  icon={GraduationCap}
                  label="System design interview mode"
                  checked={interviewOn}
                  onClick={() => {
                    setMenu(false);
                    onToggleInterview();
                  }}
                />
              )}
              {onOpenCode && (
                <MenuItem
                  icon={Code2}
                  label="Diagram as code…"
                  onClick={() => {
                    setMenu(false);
                    onOpenCode();
                  }}
                />
              )}
              <MenuItem
                icon={Maximize2}
                label="Presentation mode"
                onClick={() => {
                  setMenu(false);
                  onPresent();
                }}
              />
              <MenuItem
                icon={Keyboard}
                label="Keyboard shortcuts"
                hint="?"
                onClick={() => {
                  setMenu(false);
                  onOpenShortcuts();
                }}
              />
              {!ui.readOnly && (
                <>
                  <div className="my-1 h-px bg-white/10" />
                  <MenuItem
                    icon={Trash2}
                    danger
                    label="Clear board"
                    onClick={() => {
                      setMenu(false);
                      if (engine.store.size && window.confirm("Remove everything from this board? You can still undo.")) {
                        engine.selectAll();
                        engine.store.removeMany(Array.from(engine.store.els.keys()));
                        engine.clearSelection();
                      }
                    }}
                  />
                </>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
