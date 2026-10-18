"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  ArrowRightLeft,
  Eraser,
  Frame,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Library,
  Minus,
  MousePointer2,
  Pencil,
  Spline,
  StickyNote,
  Type,
  CornerDownRight,
  ArrowUpRight,
} from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { SHAPE_KINDS, SHAPE_LABELS } from "@/lib/canvas/shapes";
import type { ArrowHead, Route, ShapeKind, ToolId } from "@/lib/canvas/types";
import { ShapePreview } from "./ShapePreview";
import { useUi } from "./hooks";

type PopoverId = "shape" | "connector" | "pen";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Tip({ label, keys }: { label: string; keys?: string }) {
  return (
    <span className="pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-lg border border-white/10 bg-[#1b1b1f] px-2.5 py-1.5 text-[11px] font-medium text-zinc-100 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 tall:left-full tall:top-1/2 tall:ml-3 tall:block tall:-translate-y-1/2">
      {label}
      {keys && <kbd className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{keys}</kbd>}
    </span>
  );
}

function ToolButton({
  active,
  label,
  keys,
  onClick,
  onDoubleClick,
  children,
  hasMenu,
  onMenu,
  locked,
  disabled,
}: {
  active?: boolean;
  label: string;
  keys?: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  children: React.ReactNode;
  hasMenu?: boolean;
  onMenu?: () => void;
  locked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="group relative flex shrink-0 items-center">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${
          active ? "bg-white text-black shadow-[0_2px_12px_rgba(255,255,255,0.18)]" : "text-zinc-400 hover:bg-white/10 hover:text-white"
        }`}
      >
        {children}
        {locked && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
      </button>
      {hasMenu && (
        <button
          type="button"
          aria-label={`${label} options`}
          onClick={(e) => {
            e.stopPropagation();
            onMenu?.();
          }}
          className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-sm opacity-60 hover:opacity-100"
        >
          <svg viewBox="0 0 8 8" className={`h-full w-full ${active ? "text-black" : "text-zinc-400"}`} fill="currentColor">
            <path d="M8 1 L8 8 L1 8 Z" />
          </svg>
        </button>
      )}
      <Tip label={label} keys={keys} />
    </div>
  );
}

/**
 * Floating menu rendered in a portal (so the toolbar's overflow/transform never clips it) and
 * anchored to its trigger: to the right on roomy screens, above it on compact ones.
 */
function Popover({ children, onClose, anchorRect }: { children: React.ReactNode; onClose: () => void; anchorRect: DOMRect }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const a = anchorRect;
  const tall = window.matchMedia("(min-width: 768px) and (min-height: 601px)").matches;
  const pos: React.CSSProperties = tall
    ? { left: a.right + 12, top: Math.max(8, Math.min(a.top, window.innerHeight - 280)) }
    : { left: Math.max(8, Math.min(a.left + a.width / 2 - 100, window.innerWidth - 216)), bottom: window.innerHeight - a.top + 12 };
  React.useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} style={{ position: "fixed", ...pos }} className="z-[60] rounded-2xl border border-white/10 bg-[#141416]/95 p-2 shadow-2xl backdrop-blur-xl" data-slate-ui>
      {children}
    </div>,
    document.body
  );
}

const CONNECTORS: { id: string; label: string; icon: React.ElementType; route: Route; start: ArrowHead; end: ArrowHead; tool: ToolId; dash?: boolean }[] = [
  { id: "elbow", label: "Elbow arrow", icon: CornerDownRight, route: "elbow", start: "none", end: "arrow", tool: "connector" },
  { id: "straight", label: "Straight arrow", icon: ArrowUpRight, route: "straight", start: "none", end: "arrow", tool: "connector" },
  { id: "curve", label: "Curved arrow", icon: Spline, route: "curve", start: "none", end: "arrow", tool: "connector" },
  { id: "double", label: "Two-way arrow", icon: ArrowRightLeft, route: "elbow", start: "arrow", end: "arrow", tool: "connector" },
  { id: "line", label: "Line", icon: Minus, route: "straight", start: "none", end: "none", tool: "line" },
];

export function Toolbar({ engine, onToggleLibrary, libraryOpen }: { engine: Engine; onToggleLibrary: () => void; libraryOpen: boolean }) {
  const ui = useUi(engine);
  const [open, setOpen] = React.useState<{ id: PopoverId; rect: DOMRect } | null>(null);
  const close = React.useCallback(() => setOpen(null), []);
  const toggle = (id: PopoverId, ref: React.RefObject<HTMLElement | null>) => {
    if (open?.id === id) return setOpen(null);
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setOpen({ id, rect });
  };
  const shapeRef = React.useRef<HTMLDivElement | null>(null);
  const connectorRef = React.useRef<HTMLDivElement | null>(null);
  const penRef = React.useRef<HTMLDivElement | null>(null);
  const tool = ui.tool;
  const ro = ui.readOnly;
  const mod = isMac ? "⌘" : "Ctrl";
  void mod;

  const pick = (t: ToolId, opts?: { shape?: ShapeKind }) => {
    engine.setTool(t, opts);
    setOpen(null);
  };
  const lock = (t: ToolId) => engine.setTool(t, { lock: !ui.toolLocked || ui.tool !== t });

  const connectorActive = tool === "connector" || tool === "line";
  const penActive = tool === "pen" || tool === "highlighter";

  return (
    <div
      className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-[#141416]/85 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl [scrollbar-width:none] tall:bottom-auto tall:left-4 tall:top-1/2 tall:max-w-none tall:-translate-y-1/2 tall:translate-x-0 tall:flex-col tall:overflow-visible tall:py-2"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolButton active={tool === "select"} label="Select" keys="V" onClick={() => pick("select")}>
        <MousePointer2 className="h-[18px] w-[18px]" />
      </ToolButton>
      <ToolButton active={tool === "hand"} label="Hand (pan)" keys="H" onClick={() => pick("hand")}>
        <Hand className="h-[18px] w-[18px]" />
      </ToolButton>

      <div className="mx-1 h-6 w-px shrink-0 bg-white/10 tall:mx-0 tall:my-1 tall:h-px tall:w-6" />

      <div className="relative" ref={shapeRef}>
        <ToolButton
          active={tool === "shape"}
          label={SHAPE_LABELS[ui.shapeKind]}
          keys="R · O · D"
          hasMenu
          locked={tool === "shape" && ui.toolLocked}
          onMenu={() => toggle("shape", shapeRef)}
          onClick={() => pick("shape")}
          onDoubleClick={() => lock("shape")}
          disabled={ro}
        >
          <ShapePreview kind={ui.shapeKind} size={22} />
        </ToolButton>
        {open?.id === "shape" && (
          <Popover onClose={close} anchorRect={open.rect}>
            <div className="grid w-[188px] grid-cols-4 gap-1">
              {SHAPE_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  title={SHAPE_LABELS[k]}
                  onClick={() => pick("shape", { shape: k })}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                    ui.shapeKind === k ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  <ShapePreview kind={k} size={24} />
                </button>
              ))}
            </div>
          </Popover>
        )}
      </div>

      <div className="relative" ref={connectorRef}>
        <ToolButton
          active={connectorActive}
          label="Arrow"
          keys="A"
          hasMenu
          locked={connectorActive && ui.toolLocked}
          onMenu={() => toggle("connector", connectorRef)}
          onClick={() => pick("connector")}
          onDoubleClick={() => lock("connector")}
          disabled={ro}
        >
          {tool === "line" ? <Minus className="h-[18px] w-[18px]" /> : <ArrowRight className="h-[18px] w-[18px] -rotate-45" />}
        </ToolButton>
        {open?.id === "connector" && (
          <Popover onClose={close} anchorRect={open.rect}>
            <div className="w-48">
              {CONNECTORS.map((c) => {
                const Icon = c.icon;
                const active = c.tool === tool && (c.tool === "line" || (ui.style.route === c.route && ui.style.startHead === c.start && ui.style.endHead === c.end));
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      engine.setTool(c.tool);
                      if (c.tool === "connector") {
                        engine.style = { ...engine.style, route: c.route, startHead: c.start, endHead: c.end };
                        engine.scheduleUi();
                      }
                      setOpen(null);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${active ? "bg-white text-black" : "text-zinc-200 hover:bg-white/10"}`}
                  >
                    <Icon className="h-4 w-4" />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </Popover>
        )}
      </div>

      <div className="relative" ref={penRef}>
        <ToolButton
          active={penActive}
          label={tool === "highlighter" ? "Highlighter" : "Pen"}
          keys="P"
          hasMenu
          onMenu={() => toggle("pen", penRef)}
          onClick={() => pick(tool === "highlighter" ? "highlighter" : "pen")}
          disabled={ro}
        >
          {tool === "highlighter" ? <Highlighter className="h-[18px] w-[18px]" /> : <Pencil className="h-[18px] w-[18px]" />}
        </ToolButton>
        {open?.id === "pen" && (
          <Popover onClose={close} anchorRect={open.rect}>
            <div className="w-44">
              <button type="button" onClick={() => pick("pen")} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${tool === "pen" ? "bg-white text-black" : "text-zinc-200 hover:bg-white/10"}`}>
                <Pencil className="h-4 w-4" /> Pen <kbd className="ml-auto font-mono text-[10px] opacity-60">P</kbd>
              </button>
              <button type="button" onClick={() => pick("highlighter")} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${tool === "highlighter" ? "bg-white text-black" : "text-zinc-200 hover:bg-white/10"}`}>
                <Highlighter className="h-4 w-4" /> Highlighter <kbd className="ml-auto font-mono text-[10px] opacity-60">⇧P</kbd>
              </button>
            </div>
          </Popover>
        )}
      </div>

      <ToolButton active={tool === "text"} label="Text" keys="T" onClick={() => pick("text")} disabled={ro}>
        <Type className="h-[18px] w-[18px]" />
      </ToolButton>
      <ToolButton active={tool === "sticky"} label="Sticky note" keys="N" onClick={() => pick("sticky")} disabled={ro}>
        <StickyNote className="h-[18px] w-[18px]" />
      </ToolButton>
      <ToolButton active={tool === "frame"} label="Frame" keys="F" onClick={() => pick("frame")} disabled={ro}>
        <Frame className="h-[18px] w-[18px]" />
      </ToolButton>
      <ToolButton active={tool === "image"} label="Image" keys="I" onClick={() => pick("image")} disabled={ro}>
        <ImageIcon className="h-[18px] w-[18px]" />
      </ToolButton>

      <div className="mx-1 h-6 w-px shrink-0 bg-white/10 tall:mx-0 tall:my-1 tall:h-px tall:w-6" />

      <ToolButton active={libraryOpen} label="Icons & shapes" keys="⇧I" onClick={onToggleLibrary} disabled={ro}>
        <Library className="h-[18px] w-[18px]" />
      </ToolButton>
      <ToolButton active={tool === "eraser"} label="Eraser" keys="E" onClick={() => pick("eraser")} disabled={ro}>
        <Eraser className="h-[18px] w-[18px]" />
      </ToolButton>
    </div>
  );
}
