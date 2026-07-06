"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Layout,
  FileText,
  Settings,
  Users,
  Sparkles,
  Command,
  ArrowRight,
  ShieldCheck,
  Moon,
  Home,
  Database,
  Cpu
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface CommandItem {
  id: string;
  category: "Actions" | "Navigation" | "Settings";
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewSlate?: () => void;
  onGoDashboard?: () => void;
  onAiGenerate?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewSlate,
  onGoDashboard,
  onAiGenerate,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const commandItems: CommandItem[] = [
    {
      id: "cmd-ai-generate",
      category: "Actions",
      title: "Generate System Architecture with AI",
      subtitle: "Ask Slate AI to map out microservices, databases & APIs automatically",
      icon: Sparkles,
      shortcut: "⌘A",
      action: () => {
        onOpenChange(false);
        if (onAiGenerate) {
          onAiGenerate();
        } else if (onNewSlate) {
          onNewSlate();
        } else {
          router.push("/dashboard");
        }
      },
    },
    {
      id: "cmd-new-slate",
      category: "Actions",
      title: "Create New Slate Canvas",
      subtitle: "Open a fresh infinite whiteboard & document canvas workspace",
      icon: Plus,
      shortcut: "⌘N",
      action: () => {
        onOpenChange(false);
        if (onNewSlate) onNewSlate();
      },
    },
    {
      id: "cmd-nav-dashboard",
      category: "Navigation",
      title: "Go to Dashboard",
      subtitle: "View all your architecture whiteboards, templates & workspace settings",
      icon: Layout,
      shortcut: "⌘D",
      action: () => {
        onOpenChange(false);
        if (onGoDashboard) {
          onGoDashboard();
        } else {
          router.push("/dashboard");
        }
      },
    },
    {
      id: "cmd-nav-home",
      category: "Navigation",
      title: "Return to Home Page",
      subtitle: "Go back to Slate landing page and feature showcase",
      icon: Home,
      action: () => {
        onOpenChange(false);
        router.push("/");
      },
    },
  ];

  const filteredItems = commandItems.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(query.toLowerCase()))
  );

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }

      if (!open) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filteredItems, selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0F131D] border border-[#2B3548] text-white p-0 max-w-3xl sm:max-w-3xl rounded-2xl shadow-2xl overflow-hidden backdrop-blur-2xl">
        
        {/* Search Bar Input (Wide & Spacious) */}
        <div className="flex items-center gap-4 px-6 py-4.5 border-b border-[#2B3548] bg-[#141A29]">
          <Search className="w-5 h-5 text-blue-400 shrink-0" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command or search architecture slates... (Press Esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-base font-medium text-white placeholder-slate-400 outline-none font-sans"
          />
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/15 bg-white/5 text-xs font-mono text-slate-300 shrink-0">
            <Command className="w-3.5 h-3.5 text-blue-400" />
            <span>K</span>
          </div>
        </div>

        {/* Command List Results */}
        <div className="p-3 max-h-[460px] overflow-y-auto space-y-1.5">
          {filteredItems.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-400">
              No matching commands or slates found for "{query}"
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all ${
                    isSelected ? "bg-blue-600/20 border border-blue-500/40 text-white shadow-lg" : "text-slate-300 hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-xl ${isSelected ? "bg-blue-600 text-white shadow-md shadow-blue-500/30" : "bg-white/5 text-slate-400"}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        {item.title}
                        {item.shortcut && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-slate-400">
                            {item.shortcut}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <div className="text-xs text-slate-400 mt-0.5">{item.subtitle}</div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-400 font-bold px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <span>Jump</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-6 py-3 border-t border-[#2B3548] bg-[#0B0E17] flex items-center justify-between text-xs text-slate-400 font-medium">
          <div className="flex items-center gap-3">
            <span>Use <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white font-mono">↑</kbd> <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white font-mono">↓</kbd> to navigate</span>
            <span>•</span>
            <span>Press <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white font-mono">↵</kbd> to select</span>
          </div>
          <span className="text-blue-400 font-mono text-[11px]">SLATE RAYCAST 2.0</span>
        </div>

      </DialogContent>
    </Dialog>
  );
}
