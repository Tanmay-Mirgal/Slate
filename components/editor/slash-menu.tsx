"use client";

import * as React from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Command } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  category: string;
  action: () => void;
}

interface SlashMenuProps {
  open: boolean;
  query: string;
  items: SlashCommandItem[];
  selectedIndex: number;
  position: { left: number; top: number } | null;
  onSelectIndex: (index: number) => void;
  onSelectItem: (item: SlashCommandItem) => void;
  onClose: () => void;
}

export function SlashMenu({
  open,
  query,
  items,
  selectedIndex,
  position,
  onSelectIndex,
  onSelectItem,
  onClose,
}: SlashMenuProps) {
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open || !listRef.current) return;

    const active = listRef.current.querySelector<HTMLButtonElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open || !position) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -8 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="fixed z-50 w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-[#101114]/95 shadow-[0_20px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3 text-[11px] font-medium text-white/65">
        <Command className="h-3.5 w-3.5 text-white/70" />
        <span>Slash commands</span>
        <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/45">
          {query || " "}
        </span>
      </div>

      <div ref={listRef} className="max-h-[320px] overflow-auto p-2">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-white/45">
            No matching commands
          </div>
        ) : (
          items.map((item, index) => {
            const Icon = item.icon;
            const active = index === selectedIndex;

            return (
              <button
                key={item.id}
                type="button"
                data-active={active}
                onMouseEnter={() => onSelectIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectItem(item);
                  onClose();
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border border-white/10 bg-white/10 text-white"
                    : "border border-transparent text-white/80 hover:bg-white/5"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                    active
                      ? "border-white/10 bg-white text-black"
                      : "border-white/10 bg-white/5 text-white/70"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span>{item.title}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-white/45">
                      {item.category}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-white/45">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
