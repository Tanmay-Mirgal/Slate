"use client";

import * as React from "react";
import { Minimize2 } from "lucide-react";
import { DEFAULT_VIEW, Engine } from "@/lib/canvas/engine";
import type { ViewSettings } from "@/lib/canvas/types";
import { BottomBar } from "./BottomBar";
import { CanvasBoard } from "./CanvasBoard";
import { CodeDialog } from "./CodeDialog";
import { ExportDialog } from "./ExportDialog";
import { LibraryPanel } from "./LibraryPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Toolbar } from "./Toolbar";
import { TopBar, type ViewMode } from "./TopBar";
import { useUi } from "./hooks";

const VIEW_KEY = "slate-view-v2";

/** Creates one engine per board and restores the user's view preferences (theme, grid, snapping). */
export function useBoardEngine(): Engine {
  const [engine] = React.useState(() => new Engine());
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEW_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ViewSettings>;
        engine.setView({ ...DEFAULT_VIEW, ...saved });
      }
    } catch {
      /* private mode etc. */
    }
    let last = JSON.stringify(engine.view);
    const unsub = engine.subscribeUi(() => {
      const next = JSON.stringify(engine.view);
      if (next === last) return;
      last = next;
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        /* ignore */
      }
    });
    return () => {
      unsub();
    };
  }, [engine]);
  React.useEffect(() => () => engine.dispose(), [engine]);
  React.useEffect(() => {
    // Handy for debugging in the browser console during development only.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __slate?: Engine }).__slate = engine;
  }, [engine]);
  return engine;
}

interface Toast {
  id: number;
  msg: string;
  kind: "info" | "error";
}

export interface BoardShellProps {
  engine: Engine;
  title: string;
  onRename?: (title: string) => void;
  backHref: string;
  actions?: React.ReactNode;
  docSlot?: React.ReactNode;
  mode?: ViewMode;
  onModeChange?: (m: ViewMode) => void;
  onOpenCommand?: () => void;
  /** Renders the AI drawer; the shell owns its open state so panels and the top bar stay in step. */
  renderAi?: (ctx: { isOpen: boolean; onClose: () => void; onOpenCode: (o?: { code?: string; replaceDiagramId?: string }) => void }) => React.ReactNode;
  defaultAiOpen?: boolean;
  aiLocked?: boolean;
  children?: React.ReactNode;
}

export function BoardShell({
  engine,
  title,
  onRename,
  backHref,
  actions,
  docSlot,
  mode = "canvas",
  onModeChange,
  onOpenCommand,
  renderAi,
  defaultAiOpen = false,
  aiLocked,
  children,
}: BoardShellProps) {
  const ui = useUi(engine);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [present, setPresent] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(defaultAiOpen);
  const [code, setCode] = React.useState<{ open: boolean; code?: string; replaceDiagramId?: string }>({ open: false });
  const rightInset = aiOpen && !present ? 400 : 0;
  const openCode = React.useCallback((o?: { code?: string; replaceDiagramId?: string }) => setCode({ open: true, ...o }), []);

  React.useEffect(() => {
    engine.configure({ onOpenCode: openCode, onOpenAi: renderAi ? () => setAiOpen(true) : null, onOpenExport: () => setExportOpen(true) });
    return () => engine.configure({ onOpenCode: null, onOpenAi: null, onOpenExport: null });
  }, [engine, openCode, renderAi]);
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  React.useEffect(() => {
    let id = 0;
    engine.configure({
      onToast: (msg, kind = "info") => {
        const t = { id: ++id, msg, kind };
        setToasts((list) => [...list.slice(-3), t]);
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), 4200);
      },
    });
    return () => engine.configure({ onToast: null });
  }, [engine]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.shiftKey && (e.key === "I" || e.key === "i") && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setLibraryOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "E" || e.key === "e")) {
        e.preventDefault();
        setExportOpen(true);
      } else if (e.key === "Escape" && present) {
        setPresent(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present]);

  // Warn before leaving with unsaved edits.
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (engine.store.hasPending()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [engine]);

  React.useEffect(() => {
    // the canvas keeps its size when the window layout changes (split view / panels)
    const t = setTimeout(() => engine.requestRender(), 50);
    return () => clearTimeout(t);
  }, [mode, engine, present, rightInset]);

  const showCanvas = mode !== "document";
  const showDoc = mode !== "canvas";

  // overflow-clip (not hidden): a clipped box can never be scrolled programmatically, e.g. by
  // scrollIntoView on the off-canvas AI drawer.
  return (
    <div className="relative flex h-full w-full overflow-clip bg-[#0a0a0a] text-white">
      {showDoc && <div className={`relative min-w-0 overflow-y-auto pt-16 ${mode === "split" ? "w-1/2 border-r border-white/10" : "w-full"}`}>{docSlot}</div>}
      <div className={`relative min-w-0 ${showCanvas ? "flex-1" : "hidden"}`} style={{ marginRight: rightInset }}>
        <CanvasBoard engine={engine}>
          {!present && showCanvas && (
            <>
              <Toolbar engine={engine} libraryOpen={libraryOpen} onToggleLibrary={() => setLibraryOpen((v) => !v)} />
              <LibraryPanel engine={engine} open={libraryOpen} onClose={() => setLibraryOpen(false)} />
              <PropertiesPanel engine={engine} rightOffset={16 + rightInset} />
              <BottomBar engine={engine} />
            </>
          )}
        </CanvasBoard>
      </div>

      {!present && (
        <div className="pointer-events-none absolute inset-0 z-40" style={{ paddingRight: rightInset }}>
          <TopBar
            engine={engine}
            title={title}
            onRename={onRename}
            backHref={backHref}
            mode={mode}
            onMode={onModeChange}
            onOpenExport={() => setExportOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenCommand={onOpenCommand}
            onOpenCode={() => openCode()}
            onToggleAi={renderAi ? () => setAiOpen((v) => !v) : undefined}
            aiOpen={aiOpen}
            aiLocked={aiLocked}
            onPresent={() => setPresent(true)}
            actions={actions}
          />
        </div>
      )}

      {present && (
        <button
          type="button"
          onClick={() => setPresent(false)}
          className="absolute right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur hover:text-white"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Exit presentation <kbd className="rounded bg-white/10 px-1 font-mono text-[10px]">Esc</kbd>
        </button>
      )}

      {renderAi && !present && renderAi({ isOpen: aiOpen, onClose: () => setAiOpen(false), onOpenCode: openCode })}

      {children}

      <CodeDialog engine={engine} open={code.open} onOpenChange={(o) => setCode((c) => ({ ...c, open: o }))} initial={{ code: code.code, replaceDiagramId: code.replaceDiagramId }} />
      <ExportDialog engine={engine} open={exportOpen} onOpenChange={setExportOpen} title={title} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <div className="pointer-events-none absolute inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-4 py-2.5 text-[13px] font-medium shadow-2xl backdrop-blur-xl ${
              t.kind === "error" ? "border-red-500/30 bg-red-950/80 text-red-100" : "border-white/10 bg-[#18181b]/90 text-zinc-100"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
      <div className="sr-only" aria-live="polite">
        {ui.sync === "saving" ? "Saving" : "Saved"}
      </div>
    </div>
  );
}
