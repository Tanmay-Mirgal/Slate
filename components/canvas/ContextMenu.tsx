"use client";

import * as React from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Grid3x3,
  Group,
  Lock,
  Maximize,
  MousePointer2,
  Scissors,
  SquareArrowDown,
  SquareArrowUp,
  Trash2,
  Ungroup,
  Unlock,
  Pencil,
  Code2,
  ImagePlus,
} from "lucide-react";
import {
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  pasteElements,
  pasteText,
  reorder,
  setLocked,
  ungroupSelection,
  type AlignOp,
} from "@/lib/canvas/commands";
import type { Engine, UiState } from "@/lib/canvas/engine";
import { graphToDsl } from "@/lib/diagram/dsl";
import { commonDiagramId, graphFromElements } from "@/lib/diagram/extract";
import { useUi } from "./hooks";

type Menu = NonNullable<UiState["contextMenu"]>;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

function Item({
  icon: Icon,
  label,
  shortcut,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-200 hover:bg-white/10"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="text-[11px] text-zinc-500">{shortcut}</span>}
    </button>
  );
}

const Sep = () => <div className="my-1 h-px bg-white/10" />;

export function ContextMenu({ engine, menu }: { engine: Engine; menu: Menu }) {
  const ui = useUi(engine);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState({ x: menu.x, y: menu.y });

  const close = React.useCallback(() => engine.closeContextMenu(), [engine]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, engine.width - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, engine.height - r.height - 8)),
    });
  }, [menu.x, menu.y, engine, ui.selection.length]);

  React.useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [close]);

  const run = (fn: () => void) => () => {
    fn();
    close();
  };
  const has = ui.selection.length > 0;
  const multi = ui.selection.length > 1;
  const info = ui.selectionInfo;
  const single = ui.selection.length === 1 ? engine.store.get(ui.selection[0]) : null;
  const at = engine.screenToWorld({ x: menu.x, y: menu.y });

  const paste = async () => {
    if (engine.clipboardMemo.length) {
      pasteElements(engine, engine.clipboardMemo, at);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      await pasteText(engine, text, at);
    } catch {
      engine.toast("Use Ctrl+V to paste from your system clipboard", "info");
    }
  };

  const align = (op: AlignOp) => run(() => alignSelection(engine, op));

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      data-slate-ui
      className="absolute z-50 w-60 rounded-xl border border-white/10 bg-[#141416]/95 p-1.5 shadow-2xl backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {has ? (
        <>
          <Item icon={Scissors} label="Cut" shortcut={`${MOD}X`} onClick={run(() => void cutSelection(engine))} />
          <Item icon={Copy} label="Copy" shortcut={`${MOD}C`} onClick={run(() => void copySelection(engine))} />
          <Item icon={ClipboardPaste} label="Paste" shortcut={`${MOD}V`} onClick={run(() => void paste())} />
          <Item icon={CopyPlus} label="Duplicate" shortcut={`${MOD}D`} onClick={run(() => duplicateSelection(engine))} />
          <Sep />
          {single && single.type !== "image" && single.type !== "pen" && (
            <Item
              icon={Pencil}
              label="Edit text"
              shortcut="Enter"
              onClick={run(() => {
                const field = single.type === "card" ? "card" : single.type === "frame" || single.type === "table" ? "title" : single.type === "connector" ? "label" : single.type === "icon" ? "iconLabel" : "text";
                engine.startEditing(single.id, field);
              })}
            />
          )}
          {engine.onOpenCode && ui.selection.length > 0 && (
            <Item
              icon={Code2}
              label="Edit as diagram code"
              onClick={run(() => {
                const sel = engine.selectedElements();
                const diagramId = commonDiagramId(sel);
                const pool = diagramId ? engine.store.list().filter((e) => e.diagramId === diagramId) : sel;
                const g = graphFromElements(pool);
                if (g.nodes.length === 0) {
                  engine.toast("Select some nodes to turn into code", "info");
                  return;
                }
                engine.onOpenCode?.({ code: graphToDsl(g), replaceDiagramId: diagramId });
              })}
            />
          )}
          {engine.onInsertSnapshot && !ui.readOnly && (
            <Item icon={ImagePlus} label="Insert snapshot into document" onClick={run(() => engine.onInsertSnapshot?.())} />
          )}
          <Item icon={SquareArrowUp} label="Bring forward" shortcut={`${MOD}]`} onClick={run(() => reorder(engine, "forward"))} />
          <Item icon={ArrowUpToLine} label="Bring to front" shortcut={`${SHIFT}${MOD}]`} onClick={run(() => reorder(engine, "front"))} />
          <Item icon={SquareArrowDown} label="Send backward" shortcut={`${MOD}[`} onClick={run(() => reorder(engine, "backward"))} />
          <Item icon={ArrowDownToLine} label="Send to back" shortcut={`${SHIFT}${MOD}[`} onClick={run(() => reorder(engine, "back"))} />
          <Sep />
          {multi && (
            <>
              <div className="flex items-center justify-between px-1.5 py-1">
                {(
                  [
                    ["left", AlignStartVertical],
                    ["center", AlignCenterVertical],
                    ["right", AlignEndVertical],
                    ["top", AlignStartHorizontal],
                    ["middle", AlignCenterHorizontal],
                    ["bottom", AlignEndHorizontal],
                  ] as [AlignOp, React.ElementType][]
                ).map(([op, Icon]) => (
                  <button key={op} type="button" title={`Align ${op}`} onClick={align(op)} className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10">
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
              <Item icon={Group} label="Group" shortcut={`${MOD}G`} onClick={run(() => groupSelection(engine))} />
            </>
          )}
          {info.grouped && <Item icon={Ungroup} label="Ungroup" shortcut={`${SHIFT}${MOD}G`} onClick={run(() => ungroupSelection(engine))} />}
          <Item icon={info.locked ? Unlock : Lock} label={info.locked ? "Unlock" : "Lock"} shortcut={`${MOD}L`} onClick={run(() => setLocked(engine, !info.locked))} />
          <Sep />
          <Item icon={Trash2} label="Delete" shortcut="Del" danger onClick={run(() => deleteSelection(engine))} />
        </>
      ) : (
        <>
          <Item icon={ClipboardPaste} label="Paste here" shortcut={`${MOD}V`} onClick={run(() => void paste())} />
          <Item icon={MousePointer2} label="Select all" shortcut={`${MOD}A`} onClick={run(() => engine.selectAll())} />
          <Sep />
          <Item icon={Maximize} label="Zoom to fit" shortcut={`${SHIFT}1`} onClick={run(() => engine.fitContent())} />
          {engine.onInsertSnapshot && !ui.readOnly && <Item icon={ImagePlus} label="Insert board snapshot into document" onClick={run(() => engine.onInsertSnapshot?.())} />}
          <Item
            icon={Grid3x3}
            label={ui.view.grid === "none" ? "Show grid" : "Hide grid"}
            shortcut={`${MOD}'`}
            onClick={run(() => engine.setView({ grid: ui.view.grid === "none" ? "dots" : "none" }))}
          />
        </>
      )}
    </div>
  );
}
