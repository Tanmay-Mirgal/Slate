"use client";

import * as React from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Group,
  Lock,
  SquareArrowDown,
  SquareArrowUp,
  Trash2,
  Ungroup,
  Unlock,
  FlipHorizontal2,
  FlipVertical2,
} from "lucide-react";
import {
  alignSelection,
  applyStyle,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  flipSelection,
  groupSelection,
  reorder,
  setLocked,
  ungroupSelection,
  type AlignOp,
  type StylePatch,
} from "@/lib/canvas/commands";
import type { Engine } from "@/lib/canvas/engine";
import { FILL_PALETTE, STICKY_COLORS, STROKE_PALETTE, THEMES, parseColor, resolveColor, toHex } from "@/lib/canvas/theme";
import type { ArrowHead, Dash, FontFamily, Route, TextAlign } from "@/lib/canvas/types";
import { useUi } from "./hooks";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-t border-white/[0.06] px-3 py-2.5 first:border-t-0">
    <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
    {children}
  </div>
);

function Swatches({
  palette,
  value,
  onPick,
  theme,
  allowCustom = true,
}: {
  palette: string[];
  value: string | "mixed" | null;
  onPick: (c: string) => void;
  theme: "dark" | "light";
  allowCustom?: boolean;
}) {
  const colors = THEMES[theme];
  const customRef = React.useRef<HTMLInputElement | null>(null);
  const resolved = value && value !== "mixed" ? resolveColor(value, theme, "transparent") : null;
  const custom = value && value !== "mixed" && !palette.includes(value);
  const cur = resolved ? parseColor(resolved) : null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {palette.map((c) => {
        const r = resolveColor(c, theme, "transparent");
        const active = value === c;
        return (
          <button
            key={c}
            type="button"
            title={c === "transparent" ? "None" : c === "ink" ? "Default" : c}
            onClick={() => onPick(c)}
            className={`relative h-[22px] w-[22px] rounded-full border transition-transform hover:scale-110 ${active ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-[#141416]" : "border-white/15"}`}
            style={{ background: r === "transparent" ? "transparent" : r }}
          >
            {r === "transparent" && <span className="absolute left-1/2 top-1/2 h-px w-[26px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-500" />}
          </button>
        );
      })}
      {allowCustom && (
        <>
          <button
            type="button"
            title="Custom colour"
            onClick={() => customRef.current?.click()}
            className={`h-[22px] w-[22px] rounded-full border border-white/15 transition-transform hover:scale-110 ${custom ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-[#141416]" : ""}`}
            style={{ background: custom && resolved ? resolved : "conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#6366f1,#ec4899,#ef4444)" }}
          />
          <input
            ref={customRef}
            type="color"
            className="sr-only"
            value={cur ? toHex(cur) : colors.ink.startsWith("#") ? colors.ink : "#ffffff"}
            onChange={(e) => onPick(e.target.value)}
          />
        </>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T | "mixed" | null;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex h-7 flex-1 items-center justify-center rounded-md px-1.5 text-xs font-medium transition-colors ${value === o.value ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const HeadGlyph = ({ kind, flip }: { kind: ArrowHead; flip?: boolean }) => (
  <svg width="30" height="14" viewBox="0 0 30 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M3 7H24" />
    {kind === "arrow" && <path d="M19 2.5L26 7L19 11.5" />}
    {kind === "triangle" && <path d="M18 2.5L27 7L18 11.5Z" fill="currentColor" />}
    {kind === "diamond" && <path d="M17 7L22 3L27 7L22 11Z" />}
    {kind === "dot" && <circle cx="24" cy="7" r="3" />}
    {kind === "bar" && <path d="M26 2V12" />}
  </svg>
);

const HEADS: ArrowHead[] = ["none", "arrow", "triangle", "diamond", "dot", "bar"];

function HeadPicker({ value, onChange, flip }: { value: ArrowHead | "mixed" | null; onChange: (h: ArrowHead) => void; flip?: boolean }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {HEADS.map((h) => (
        <button
          key={h}
          type="button"
          title={h}
          onClick={() => onChange(h)}
          className={`flex h-7 items-center justify-center rounded-md ${value === h ? "bg-white text-black" : "bg-white/[0.05] text-zinc-400 hover:text-white"}`}
        >
          <HeadGlyph kind={h} flip={flip} />
        </button>
      ))}
    </div>
  );
}

function IconBtn({ title, onClick, children, danger, active, disabled }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "text-red-400 hover:bg-red-500/10" : active ? "bg-white text-black" : "text-zinc-300 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

const FONT_LABELS: Record<FontFamily, string> = { sans: "Sans", hand: "Hand", mono: "Mono", serif: "Serif" };
const SIZES = [
  { label: "S", value: 14 },
  { label: "M", value: 18 },
  { label: "L", value: 26 },
  { label: "XL", value: 38 },
];

export function PropertiesPanel({ engine, rightOffset = 16 }: { engine: Engine; rightOffset?: number }) {
  const ui = useUi(engine);
  const [collapsed, setCollapsed] = React.useState(false);
  const info = ui.selectionInfo;
  const hasSel = info.count > 0;
  const tool = ui.tool;
  const theme = ui.view.theme;
  const d = ui.style;
  const apply = (p: StylePatch) => applyStyle(engine, p);

  if (ui.readOnly || ui.editing) return null;
  const drawing = tool === "shape" || tool === "connector" || tool === "line" || tool === "pen" || tool === "highlighter" || tool === "text" || tool === "sticky";
  if (!hasSel && !drawing) return null;

  // What to show
  const show = hasSel
    ? {
        stroke: info.canStroke,
        fill: info.canFill && !info.types.every((t) => t === "sticky"),
        width: info.canStroke && !info.types.every((t) => t === "text"),
        dash: info.canStroke && !info.types.every((t) => t === "text" || t === "pen"),
        radius: info.hasRadius,
        text: info.hasText && !info.types.every((t) => t === "connector"),
        connector: info.hasConnector,
        sticky: info.types.includes("sticky"),
        opacity: true,
        textColor: info.types.includes("shape"),
      }
    : {
        stroke: tool !== "sticky",
        fill: tool === "shape",
        width: tool !== "text" && tool !== "sticky",
        dash: tool === "shape" || tool === "connector" || tool === "line",
        radius: false,
        text: tool === "text" || tool === "shape",
        connector: tool === "connector",
        sticky: tool === "sticky",
        opacity: true,
        textColor: false,
      };

  const v = <K extends keyof typeof d>(key: K, sel: unknown) => (hasSel ? (sel as (typeof d)[K] | "mixed" | null) : d[key]);
  const stroke = v("stroke", info.stroke);
  const fill = v("fill", info.fill);
  const widthVal = v("strokeWidth", info.strokeWidth);
  const dash = v("dash", info.dash);
  const opacity = hasSel ? info.opacity ?? 1 : d.opacity;
  const fontSize = v("fontSize", info.fontSize);
  const font = v("font", info.font);
  const align = v("align", info.align);
  const route = v("route", info.route);
  const startHead = v("startHead", info.startHead);
  const endHead = v("endHead", info.endHead);

  const multi = info.count > 1;
  const nodes = engine.selectedElements().filter((e) => e.type !== "connector").length;

  return (
    <div
      className="absolute top-[72px] z-30 w-[236px] max-h-[calc(100%-168px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#141416]/92 text-zinc-200 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl [scrollbar-width:thin] max-md:hidden"
      style={{ right: rightOffset }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] font-semibold text-white">
        {hasSel ? (multi ? `${info.count} selected` : info.types[0] === "shape" ? "Shape" : info.types[0][0].toUpperCase() + info.types[0].slice(1)) : "Style"}
        {collapsed ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronUp className="h-4 w-4 text-zinc-500" />}
      </button>
      {!collapsed && (
        <>
          {show.stroke && (
            <Section title={info.types.length === 1 && info.types[0] === "text" ? "Text colour" : info.types.includes("icon") || info.types.includes("card") ? "Accent" : "Stroke"}>
              <Swatches palette={STROKE_PALETTE} value={stroke as string | "mixed" | null} theme={theme} onPick={(c) => apply({ stroke: c })} />
            </Section>
          )}
          {show.fill && (
            <Section title="Fill">
              <Swatches palette={FILL_PALETTE} value={fill as string | "mixed" | null} theme={theme} onPick={(c) => apply({ fill: c })} />
            </Section>
          )}
          {show.sticky && (
            <Section title="Note colour">
              <Swatches palette={STICKY_COLORS} value={(hasSel ? (info.fill as string | null) : d.stickyColor) ?? null} theme="light" onPick={(c) => apply({ fill: c })} />
            </Section>
          )}
          {(show.width || show.dash) && (
            <Section title="Line">
              {show.width && (
                <Segmented
                  value={widthVal as number | "mixed" | null}
                  onChange={(w) => apply({ strokeWidth: w })}
                  options={[
                    { value: 1, label: <span className="h-px w-5 bg-current" style={{ height: 1 }} />, title: "Thin" },
                    { value: 2, label: <span className="w-5 bg-current" style={{ height: 2 }} />, title: "Medium" },
                    { value: 4, label: <span className="w-5 bg-current" style={{ height: 4, borderRadius: 2 }} />, title: "Bold" },
                    { value: 7, label: <span className="w-5 bg-current" style={{ height: 6, borderRadius: 3 }} />, title: "Extra bold" },
                  ]}
                />
              )}
              {show.dash && (
                <div className="mt-2">
                  <Segmented<Dash>
                    value={dash as Dash | "mixed" | null}
                    onChange={(x) => apply({ dash: x })}
                    options={[
                      { value: "solid", label: <span className="block w-6 border-t-2 border-current" />, title: "Solid" },
                      { value: "dashed", label: <span className="block w-6 border-t-2 border-dashed border-current" />, title: "Dashed" },
                      { value: "dotted", label: <span className="block w-6 border-t-2 border-dotted border-current" />, title: "Dotted" },
                    ]}
                  />
                </div>
              )}
            </Section>
          )}
          {show.radius && (
            <Section title="Corner radius">
              <input
                type="range"
                min={0}
                max={48}
                value={Number(info.radius ?? 12)}
                onChange={(e) => apply({ radius: Number(e.target.value) })}
                className="w-full accent-indigo-400"
              />
            </Section>
          )}
          {show.connector && (
            <Section title="Connector">
              <Segmented<Route>
                value={route as Route | "mixed" | null}
                onChange={(r) => apply({ route: r })}
                options={[
                  { value: "elbow", label: "Elbow" },
                  { value: "straight", label: "Straight" },
                  { value: "curve", label: "Curve" },
                ]}
              />
              <div className="mb-1 mt-3 text-[10.5px] text-zinc-500">Start</div>
              <HeadPicker value={startHead as ArrowHead | "mixed" | null} flip onChange={(h) => apply({ startHead: h })} />
              <div className="mb-1 mt-2 text-[10.5px] text-zinc-500">End</div>
              <HeadPicker value={endHead as ArrowHead | "mixed" | null} onChange={(h) => apply({ endHead: h })} />
            </Section>
          )}
          {show.text && (
            <Section title="Text">
              <Segmented<FontFamily>
                value={font as FontFamily | "mixed" | null}
                onChange={(f) => apply({ font: f })}
                options={(Object.keys(FONT_LABELS) as FontFamily[]).map((f) => ({ value: f, label: FONT_LABELS[f] }))}
              />
              <div className="mt-2">
                <Segmented<number>
                  value={fontSize as number | "mixed" | null}
                  onChange={(s) => apply({ fontSize: s })}
                  options={SIZES.map((s) => ({ value: s.value, label: s.label, title: `${s.value}px` }))}
                />
              </div>
              {(!hasSel || !info.types.every((t) => t === "connector")) && (
                <div className="mt-2">
                  <Segmented<TextAlign>
                    value={align as TextAlign | "mixed" | null}
                    onChange={(a) => apply({ align: a })}
                    options={[
                      { value: "left", label: <AlignLeft className="h-3.5 w-3.5" /> },
                      { value: "center", label: <AlignCenter className="h-3.5 w-3.5" /> },
                      { value: "right", label: <AlignRight className="h-3.5 w-3.5" /> },
                    ]}
                  />
                </div>
              )}
              {show.textColor && hasSel && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10.5px] text-zinc-500">Text colour</div>
                  <Swatches palette={STROKE_PALETTE} value={info.textColor as string | "mixed" | null} theme={theme} onPick={(c) => apply({ textColor: c })} />
                </div>
              )}
            </Section>
          )}
          {show.opacity && (
            <Section title={`Opacity · ${Math.round(opacity * 100)}%`}>
              <input type="range" min={10} max={100} value={Math.round(opacity * 100)} onChange={(e) => apply({ opacity: Number(e.target.value) / 100 })} className="w-full accent-indigo-400" />
            </Section>
          )}
          {hasSel && (
            <Section title="Arrange">
              <div className="flex flex-wrap gap-0.5">
                <IconBtn title="Bring to front" onClick={() => reorder(engine, "front")}>
                  <ArrowUpToLine className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Bring forward" onClick={() => reorder(engine, "forward")}>
                  <SquareArrowUp className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Send backward" onClick={() => reorder(engine, "backward")}>
                  <SquareArrowDown className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Send to back" onClick={() => reorder(engine, "back")}>
                  <ArrowDownToLine className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Flip horizontal" onClick={() => flipSelection(engine, "h")}>
                  <FlipHorizontal2 className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Flip vertical" onClick={() => flipSelection(engine, "v")}>
                  <FlipVertical2 className="h-4 w-4" />
                </IconBtn>
              </div>
              {nodes > 1 && (
                <div className="mt-1.5 flex flex-wrap gap-0.5 border-t border-white/[0.06] pt-1.5">
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
                    <IconBtn key={op} title={`Align ${op}`} onClick={() => alignSelection(engine, op)}>
                      <Icon className="h-4 w-4" />
                    </IconBtn>
                  ))}
                  {nodes > 2 && (
                    <>
                      <IconBtn title="Distribute horizontally" onClick={() => distributeSelection(engine, "x")}>
                        <span className="text-[10px] font-bold">⇿</span>
                      </IconBtn>
                      <IconBtn title="Distribute vertically" onClick={() => distributeSelection(engine, "y")}>
                        <span className="text-[10px] font-bold">⇳</span>
                      </IconBtn>
                    </>
                  )}
                </div>
              )}
              <div className="mt-1.5 flex gap-0.5 border-t border-white/[0.06] pt-1.5">
                <IconBtn title="Duplicate (Ctrl+D)" onClick={() => duplicateSelection(engine)}>
                  <Copy className="h-4 w-4" />
                </IconBtn>
                {multi && (
                  <IconBtn title="Group (Ctrl+G)" onClick={() => groupSelection(engine)}>
                    <Group className="h-4 w-4" />
                  </IconBtn>
                )}
                {info.grouped && (
                  <IconBtn title="Ungroup" onClick={() => ungroupSelection(engine)}>
                    <Ungroup className="h-4 w-4" />
                  </IconBtn>
                )}
                <IconBtn title={info.locked ? "Unlock" : "Lock"} active={info.locked} onClick={() => setLocked(engine, !info.locked)}>
                  {info.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </IconBtn>
                <div className="flex-1" />
                <IconBtn title="Delete" danger onClick={() => deleteSelection(engine)}>
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
