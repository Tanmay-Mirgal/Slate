"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Check,
  CloudOff,
  Code2,
  Download,
  Eye,
  FileJson,
  Grid3x3,
  Keyboard,
  Loader2,
  Magnet,
  Maximize2,
  Menu,
  Moon,
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
import { useUi } from "./hooks";

export type ViewMode = "canvas" | "document" | "split";

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

export function TopBar({ engine, title, onRename, backHref, mode, onMode, onOpenExport, onOpenShortcuts, onOpenCommand, onOpenCode, onToggleAi, aiOpen, onPresent, actions, aiLocked }: TopBarProps) {
  const ui = useUi(engine);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const [menu, setMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [menu]);

  const commitTitle = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== title) onRename?.(t);
    else setDraft(title);
  };

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

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-3 max-md:p-2">
      {/* left cluster */}
      <div className="pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-[#141416]/85 py-1.5 pl-2 pr-3 shadow-xl backdrop-blur-xl">
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
            className="w-44 rounded-md border border-white/20 bg-black/40 px-2 py-1 text-[13px] font-semibold text-white outline-none"
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
            className="max-w-[200px] truncate rounded-md px-1.5 py-1 text-[13px] font-semibold text-white enabled:hover:bg-white/10 max-md:max-w-[110px]"
          >
            {title || "Untitled"}
          </button>
        )}
        {ui.readOnly ? (
          <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-300">
            <Eye className="h-3 w-3" /> View only
          </span>
        ) : (
          <span className="flex items-center gap-1.5 border-l border-white/10 pl-2.5 text-[11px] font-medium" title={ui.syncError ?? undefined}>
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
      </div>

      {/* mode switch */}
      {onMode && (
        <div className="pointer-events-auto absolute left-1/2 top-3 hidden -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-white/10 bg-[#141416]/85 p-1 shadow-xl backdrop-blur-xl md:flex">
          {(["canvas", "split", "document"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={`rounded-xl px-3.5 py-1.5 text-[12px] font-semibold capitalize transition-colors ${mode === m ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
            >
              {m === "document" ? "Doc" : m}
            </button>
          ))}
        </div>
      )}

      {/* right cluster */}
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#141416]/85 p-1.5 shadow-xl backdrop-blur-xl">
        {ui.peers.length > 0 && (
          <div className="flex items-center pl-1 pr-1.5" title={ui.peers.map((p) => p.name).join(", ")}>
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
          <button type="button" onClick={onOpenCommand} title="Search & commands" className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-white max-md:hidden">
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
            <Sparkles className="h-3.5 w-3.5" /> AI
          </button>
        )}
        {actions}
        <button type="button" onClick={onOpenExport} title="Export" className="flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/10">
          <Download className="h-3.5 w-3.5" />
          <span className="max-md:hidden">Export</span>
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
