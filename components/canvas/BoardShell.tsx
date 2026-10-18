"use client";

import * as React from "react";
import { Minimize2 } from "lucide-react";
import type { DocBridge } from "@/components/editor/doc-bridge";
import type { Tier } from "@/lib/billing/plans";
import { DEFAULT_VIEW, Engine } from "@/lib/canvas/engine";
import { captureSnapshot } from "@/lib/canvas/snapshot";
import type { ViewSettings } from "@/lib/canvas/types";
import { InterviewStore } from "@/lib/interview/store";
import { BottomBar } from "./BottomBar";
import { CanvasBoard } from "./CanvasBoard";
import { CodeDialog } from "./CodeDialog";
import { DocHeader } from "./DocHeader";
import { ExportDialog } from "./ExportDialog";
import { FinOpsBadge } from "./FinOpsBadge";
import { INTERVIEW_DRAWER_WIDTH, InterviewDrawer, InterviewPill } from "./InterviewMode";
import { LibraryPanel } from "./LibraryPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SplitDivider } from "./SplitDivider";
import { Toolbar } from "./Toolbar";
import { TopBar, type ViewMode } from "./TopBar";
import { TrafficSimulator } from "./TrafficSimulator";
import { useUi } from "./hooks";
import { useSplitPane } from "./useSplitPane";

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
  /** Connects the shell to the document editor: word count, markdown export, canvas snapshots. */
  docBridge?: DocBridge;
  mode?: ViewMode;
  onModeChange?: (m: ViewMode) => void;
  onOpenCommand?: () => void;
  /** Renders the AI drawer; the shell owns its open state so panels and the top bar stay in step. */
  renderAi?: (ctx: { isOpen: boolean; onClose: () => void; onOpenCode: (o?: { code?: string; replaceDiagramId?: string }) => void }) => React.ReactNode;
  defaultAiOpen?: boolean;
  aiLocked?: boolean;
  /** The plan that applies to this board; decides which FinOps details are shown. Defaults to free. */
  tier?: Tier;
  /** Opens the upgrade flow. Without it, upgrade buttons send people to sign up. */
  onUpgrade?: () => void;
  /** Start with system design interview mode on (a board opened from the interview template). */
  defaultInterview?: boolean;
  /** Key the interview timer and checklist are saved under (the board id). */
  interviewKey?: string;
  children?: React.ReactNode;
}

export function BoardShell({
  engine,
  title,
  onRename,
  backHref,
  actions,
  docSlot,
  docBridge,
  mode = "canvas",
  onModeChange,
  onOpenCommand,
  renderAi,
  defaultAiOpen = false,
  aiLocked,
  tier = "free",
  onUpgrade,
  defaultInterview = false,
  interviewKey = "local",
  children,
}: BoardShellProps) {
  const ui = useUi(engine);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [present, setPresent] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(defaultAiOpen);
  const [code, setCode] = React.useState<{ open: boolean; code?: string; replaceDiagramId?: string }>({ open: false });
  const [snapshotBusy, setSnapshotBusy] = React.useState(false);
  const { ratio: splitRatio, dragging: splitDragging, containerRef: splitContainerRef, docRef: splitDocRef, startDrag, commit: commitSplit, reset: resetSplit } = useSplitPane(engine);
  const [simulating, setSimulating] = React.useState(false);
  const [interviewStore] = React.useState(() => new InterviewStore());
  const [interviewDrawer, setInterviewDrawer] = React.useState(defaultInterview);
  const interviewOn = React.useSyncExternalStore(
    interviewStore.subscribe,
    () => interviewStore.getState().enabled,
    () => false
  );
  const aiInset = aiOpen && !present ? 400 : 0;
  const rightInset = aiInset + (interviewOn && interviewDrawer && !present ? INTERVIEW_DRAWER_WIDTH : 0);
  const upgrade = React.useCallback(() => (onUpgrade ? onUpgrade() : window.location.assign("/sign-up")), [onUpgrade]);
  const openCode = React.useCallback((o?: { code?: string; replaceDiagramId?: string }) => setCode({ open: true, ...o }), []);

  const insertSnapshot = React.useCallback(async () => {
    if (!docBridge || snapshotBusy) return;
    const stats = docBridge.getStats();
    if (stats.ready && !stats.editable) {
      engine.toast("The document is read-only, so nothing can be inserted.", "error");
      return;
    }
    setSnapshotBusy(true);
    try {
      const snap = await captureSnapshot(engine, { alt: `${title || "Board"} diagram` });
      // From canvas-only view the editor isn't mounted yet: the bridge queues the insert until it is.
      if (mode === "canvas") onModeChange?.("split");
      docBridge.insertImage({ src: snap.src, alt: snap.alt });
      engine.toast(snap.count === 1 ? "Inserted 1 element into the document" : `Inserted ${snap.count} elements into the document`);
    } catch (err) {
      engine.toast(err instanceof Error ? err.message : "Couldn't capture the canvas", "error");
    } finally {
      setSnapshotBusy(false);
    }
  }, [docBridge, engine, mode, onModeChange, snapshotBusy, title]);
  const canInsertSnapshot = !!docBridge && !!onModeChange;

  // Interview mode remembers its timer and checklist per board.
  React.useEffect(() => {
    interviewStore.load(interviewKey);
    if (defaultInterview) interviewStore.setEnabled(true);
    return () => interviewStore.flush();
  }, [interviewStore, interviewKey, defaultInterview]);

  const toggleInterview = React.useCallback(() => {
    const next = !interviewStore.getState().enabled;
    interviewStore.setEnabled(next);
    setInterviewDrawer(next);
  }, [interviewStore]);
  const toggleSimulation = React.useCallback(() => setSimulating((v) => !v), []);

  React.useEffect(() => {
    engine.configure({ onToggleSimulation: toggleSimulation, onToggleInterview: toggleInterview });
    return () => engine.configure({ onToggleSimulation: null, onToggleInterview: null });
  }, [engine, toggleSimulation, toggleInterview]);

  React.useEffect(() => {
    engine.configure({ onInsertSnapshot: canInsertSnapshot ? () => void insertSnapshot() : null });
    return () => engine.configure({ onInsertSnapshot: null });
  }, [engine, canInsertSnapshot, insertSnapshot]);

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

  const showCanvas = mode !== "document";
  const showDoc = mode !== "canvas";
  const isSplit = mode === "split" && showDoc && !!docBridge;

  // In split view the world point at the middle of the pane stays put while the pane grows or shrinks.
  React.useEffect(() => {
    engine.configure({ resizeAnchor: isSplit ? "center" : "start" });
    return () => engine.configure({ resizeAnchor: "start" });
  }, [engine, isSplit]);

  React.useEffect(() => {
    // the canvas keeps its size when the window layout changes (split view / panels)
    const t = setTimeout(() => engine.requestRender(), 50);
    return () => clearTimeout(t);
  }, [mode, engine, present, rightInset, splitRatio]);

  const topBarProps = {
    engine,
    title,
    onRename,
    backHref,
    mode,
    onMode: onModeChange,
    onOpenExport: () => setExportOpen(true),
    onOpenShortcuts: () => setShortcutsOpen(true),
    onOpenCommand,
    onOpenCode: () => openCode(),
    onToggleAi: renderAi ? () => setAiOpen((v) => !v) : undefined,
    aiOpen,
    aiLocked,
    onPresent: () => setPresent(true),
    actions,
    onInsertSnapshot: canInsertSnapshot ? () => void insertSnapshot() : undefined,
    onToggleInterview: toggleInterview,
    interviewOn,
  };

  // overflow-clip (not hidden): a clipped box can never be scrolled programmatically, e.g. by
  // scrollIntoView on the off-canvas AI drawer.
  return (
    <div className="relative flex h-full w-full overflow-clip bg-[#0a0a0a] text-white">
      <div ref={splitContainerRef} className="absolute inset-y-0 left-0 flex" style={{ right: rightInset }}>
        {showDoc && (
          <div ref={splitDocRef} className={`relative flex min-w-0 flex-col ${isSplit ? "shrink-0" : "w-full"}`} style={isSplit ? { width: `${splitRatio}%` } : undefined}>
            {isSplit && docBridge && !present && (
              <DocHeader engine={engine} title={title} onRename={onRename} backHref={backHref} bridge={docBridge} onInsertSnapshot={() => void insertSnapshot()} snapshotBusy={snapshotBusy} />
            )}
            <div className={`min-h-0 flex-1 overflow-y-auto ${isSplit ? "" : "pt-16"}`}>{docSlot}</div>
          </div>
        )}
        {isSplit && !present && (
          <SplitDivider
            ratio={splitRatio}
            dragging={splitDragging}
            onPointerDown={startDrag}
            onSet={commitSplit}
            onReset={resetSplit}
            onCollapseDoc={() => onModeChange?.("canvas")}
            onCollapseCanvas={() => onModeChange?.("document")}
          />
        )}
        <div className={`@container relative min-w-0 ${showCanvas ? "flex-1" : "hidden"}`}>
          <CanvasBoard engine={engine}>
            {!present && showCanvas && (
              <>
                <Toolbar engine={engine} libraryOpen={libraryOpen} onToggleLibrary={() => setLibraryOpen((v) => !v)} simulating={simulating} onToggleSimulation={toggleSimulation} />
                <LibraryPanel engine={engine} open={libraryOpen} onClose={() => setLibraryOpen(false)} />
                <PropertiesPanel engine={engine} rightOffset={16} />
                <BottomBar engine={engine} extra={<FinOpsBadge engine={engine} tier={tier} title={title} onUpgrade={upgrade} />} />
                {interviewOn && <InterviewPill store={interviewStore} engine={engine} drawerOpen={interviewDrawer} onToggleDrawer={() => setInterviewDrawer((v) => !v)} onClose={toggleInterview} />}
              </>
            )}
            {simulating && showCanvas && <TrafficSimulator engine={engine} onStop={toggleSimulation} hud={!present} />}
          </CanvasBoard>
          {isSplit && !present && <TopBar {...topBarProps} section="canvas" />}
        </div>
      </div>

      {/* Absolute children ignore padding, so the inset is applied to the box itself: the top bar must stay clear of the side panels. */}
      {!present && !isSplit && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-40" style={{ right: rightInset }}>
          <TopBar {...topBarProps} section="full" />
        </div>
      )}

      {/* Keeps the canvas and the editor from swallowing pointer events while the divider is dragged. */}
      {splitDragging && <div className="absolute inset-0 z-[60] cursor-col-resize" aria-hidden />}

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

      {interviewOn && !present && (
        <InterviewDrawer store={interviewStore} engine={engine} docBridge={docBridge} open={interviewDrawer} onClose={() => setInterviewDrawer(false)} rightOffset={aiInset} signedIn={!aiLocked} onUpgrade={upgrade} />
      )}

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
