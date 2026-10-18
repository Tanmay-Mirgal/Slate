"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const M = isMac ? "⌘" : "Ctrl";
const S = isMac ? "⇧" : "Shift";
const A = isMac ? "⌥" : "Alt";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Tools",
    rows: [
      ["Select", "V"],
      ["Hand / pan", "H or hold Space"],
      ["Rectangle · Ellipse · Diamond", "R · O · D"],
      ["Arrow · Line", "A · L"],
      ["Pen · Highlighter", `P · ${S}+P`],
      ["Text · Sticky · Frame", "T · N · F"],
      ["Image", "I"],
      ["Eraser", "E"],
      ["Command palette", `${M}+K`],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Undo · Redo", `${M}+Z · ${M}+${S}+Z`],
      ["Copy · Cut · Paste", `${M}+C · X · V`],
      ["Duplicate", `${M}+D or ${A}+drag`],
      ["Select all", `${M}+A`],
      ["Delete", "Del / Backspace"],
      ["Group · Ungroup", `${M}+G · ${M}+${S}+G`],
      ["Lock / unlock", `${M}+L`],
      ["Edit text", "Enter or double-click"],
      ["Nudge", `Arrows (${S} = 10px)`],
    ],
  },
  {
    title: "Arrange",
    rows: [
      ["Bring forward · to front", `${M}+] · ${M}+${S}+]`],
      ["Send backward · to back", `${M}+[ · ${M}+${S}+[`],
      ["Constrain / keep aspect", `Hold ${S}`],
      ["Resize from centre", `Hold ${A}`],
      ["Rotate in 15° steps", `Hold ${S} while rotating`],
    ],
  },
  {
    title: "Diagrams",
    rows: [
      ["Add node below · above", "Tab · Shift+Tab"],
      ["Add node in a direction", `${A}+Arrow`],
      ["Drag from a + handle", "Connect to a node or create one"],
      ["Double-click empty space", "Add text"],
    ],
  },
  {
    title: "View",
    rows: [
      ["Zoom in · out", `${M}+scroll · + / -`],
      ["Zoom to fit", `${S}+1`],
      ["Zoom to selection", `${S}+2`],
      ["Reset zoom", `${S}+0 or ${M}+0`],
      ["Toggle grid", `${M}+'`],
      ["Pan", "Scroll, or drag with Space"],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-[780px] overflow-y-auto rounded-2xl border border-white/10 bg-[#111113] p-6 text-white sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">Everything in Slate is reachable without the mouse.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{g.title}</div>
              <div className="space-y-1.5">
                {g.rows.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between gap-4 text-[13px]">
                    <span className="text-zinc-300">{label}</span>
                    <kbd className="whitespace-nowrap rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-zinc-300">{keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
