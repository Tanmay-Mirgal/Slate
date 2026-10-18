"use client";

import * as React from "react";
import { X } from "lucide-react";

/**
 * Right-hand side drawer shared by the comments and version-history panels. Same chrome as the AI
 * drawer: it slides over the board's right edge (the shell shifts the canvas by `PANEL_WIDTH`).
 */
export const PANEL_WIDTH = 400;

export function Drawer({
  open,
  title,
  icon,
  onClose,
  actions,
  children,
  ...rest
}: {
  open: boolean;
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <aside
      {...rest}
      aria-hidden={!open}
      aria-label={title}
      inert={!open}
      className={`absolute right-0 top-0 z-50 flex h-full max-w-full flex-col border-l border-white/10 bg-[#0c0c0e]/95 shadow-2xl backdrop-blur-xl transition-[transform,visibility] duration-300 ease-out ${open ? "visible translate-x-0" : "invisible translate-x-full"}`}
      style={{ width: PANEL_WIDTH }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-zinc-300">{icon}</span>
        <h2 className="flex-1 text-[14px] font-semibold text-white">{title}</h2>
        {actions}
        <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </header>
      {children}
    </aside>
  );
}
