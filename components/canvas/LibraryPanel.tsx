"use client";

import * as React from "react";
import { Search, X, StickyNote, Frame, Type, LayoutTemplate } from "lucide-react";
import { insertCardNode, insertIcon } from "@/lib/canvas/commands";
import { createShape, DEFAULT_SIZES } from "@/lib/canvas/create";
import type { Engine } from "@/lib/canvas/engine";
import { allLucideNames } from "@/lib/canvas/icons";
import { ICON_CATALOG, ICON_CATEGORIES, searchCatalog, type IconDef } from "@/lib/canvas/icons-catalog";
import { SHAPE_KINDS, SHAPE_LABELS } from "@/lib/canvas/shapes";
import type { ShapeKind } from "@/lib/canvas/types";
import { GlyphIcon } from "./GlyphIcon";
import { ShapePreview } from "./ShapePreview";

type Tab = "icons" | "shapes";
type Mode = "card" | "icon";

const prettify = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

export function LibraryPanel({ engine, open, onClose }: { engine: Engine; open: boolean; onClose: () => void }) {
  const [tab, setTab] = React.useState<Tab>("icons");
  const [mode, setMode] = React.useState<Mode>("card");
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("All");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open && tab === "icons") inputRef.current?.focus();
  }, [open, tab]);

  const results: IconDef[] = React.useMemo(() => {
    let list = query.trim() ? searchCatalog(query, 160) : ICON_CATALOG;
    if (category !== "All") list = list.filter((d) => d.category === category);
    const q = query.trim().toLowerCase();
    if (q.length >= 2 && category === "All" && list.length < 40) {
      const known = new Set(list.map((d) => d.key));
      const extra = allLucideNames()
        .filter((n) => n.toLowerCase().includes(q.replace(/\s+/g, "")) && !known.has(`lucide:${n}`))
        .slice(0, 60)
        .map<IconDef>((n) => ({ key: `lucide:${n}`, label: prettify(n), category: "More", keywords: [] }));
      list = [...list, ...extra];
    }
    return list.slice(0, 240);
  }, [query, category]);

  if (!open) return null;

  const addIcon = (d: IconDef) => (mode === "card" ? insertCardNode(engine, d.key, d.label) : insertIcon(engine, d.key, d.label));

  const addShape = (kind: ShapeKind) => {
    const c = engine.screenToWorld({ x: engine.width / 2, y: engine.height / 2 });
    const s = DEFAULT_SIZES[kind] ?? DEFAULT_SIZES.rect;
    const el = createShape(kind, { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h }, engine.style, engine.store.nextZ());
    engine.store.put(el);
    engine.select([el.id]);
    engine.markNew([el.id]);
    engine.startEditing(el.id, "text", true);
  };

  return (
    <aside
      className="absolute inset-x-2 bottom-[76px] top-20 z-30 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121214]/95 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl tall:bottom-24 tall:left-[76px] tall:right-auto tall:w-[320px]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <div className="flex gap-1 rounded-xl bg-white/5 p-1">
          {(["icons", "shapes"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize transition-colors ${tab === t ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white" aria-label="Close library">
          <X className="h-4 w-4" />
        </button>
      </div>

      {tab === "icons" ? (
        <>
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 focus-within:border-white/30">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search AWS, Postgres, Kafka, user…"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
              />
            </div>
            <div className="mt-2 flex items-center gap-1 rounded-lg bg-white/5 p-0.5 text-[11px] font-semibold">
              {(["card", "icon"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-2 py-1 transition-colors ${mode === m ? "bg-white/15 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {m === "card" ? "Node card" : "Icon only"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
            {["All", ...ICON_CATEGORIES].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${category === c ? "bg-white text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-4 content-start gap-1 overflow-y-auto px-2 pb-3">
            {results.map((d) => (
              <button
                key={d.key}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-slate-icon", JSON.stringify({ key: d.key, label: d.label }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addIcon(d)}
                title={d.label}
                className="group flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 transition-colors hover:bg-white/10"
              >
                <GlyphIcon iconKey={d.key} size={26} color={d.key.startsWith("lucide:") ? "#d4d4d8" : undefined} className="transition-transform group-hover:scale-110" />
                <span className="line-clamp-2 w-full break-words text-center text-[10px] leading-tight text-zinc-500 group-hover:text-zinc-200">{d.label}</span>
              </button>
            ))}
            {results.length === 0 && <div className="col-span-4 py-12 text-center text-xs text-zinc-500">No icons match “{query}”</div>}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Shapes</div>
          <div className="grid grid-cols-4 gap-1.5">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-slate-shape", k);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addShape(k)}
                title={SHAPE_LABELS[k]}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <ShapePreview kind={k} size={28} />
                <span className="text-[9.5px] text-zinc-500">{SHAPE_LABELS[k]}</span>
              </button>
            ))}
          </div>
          <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Basics</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: "text", label: "Text", icon: Type, tool: "text" as const },
              { id: "sticky", label: "Sticky note", icon: StickyNote, tool: "sticky" as const },
              { id: "frame", label: "Frame", icon: Frame, tool: "frame" as const },
            ].map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  engine.setTool(b.tool);
                  onClose();
                }}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.03] py-3 text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <b.icon className="h-5 w-5" />
                <span className="text-[10.5px]">{b.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-zinc-500">
            <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0" />
            Tip: click a shape then drag on the board to size it, or drag a shape from here straight onto the canvas.
          </div>
        </div>
      )}
    </aside>
  );
}
