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
  Home
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface CommandItem {
  id: string;
  category: "Actions" | "Navigation" | "Settings";
  title: string;
  subtitle?: string;
  icon: React.ElementType;
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
      id: "cmd-new-slate",
      category: "Actions",
      title: "Create New Slate",
      subtitle: "Open a new infinite whiteboard & document canvas",
      icon: Plus,
      action: () => {
        onOpenChange(false);
        if (onNewSlate) onNewSlate();
      },
    },
    {
      id: "cmd-nav-dashboard",
      category: "Navigation",
      title: "Go to Dashboard",
      subtitle: "View all your architecture whiteboards & workspace",
      icon: Layout,
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
      id: "cmd-ai-generate",
      category: "Actions",
      title: "Generate System Architecture with AI",
      subtitle: "Ask Slate AI to map out microservices, databases & APIs",
      icon: Sparkles,
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
      <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white p-0 max-w-xl rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Search Bar Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#2B2B2B] bg-[#141414]">
          <Search className="w-4.5 h-4.5 text-[#808080]" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command or search slates... (Press Esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-white placeholder-[#666666] outline-none font-sans"
          />
          <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#2B2B2B] bg-[#1A1A1A] text-[10px] font-mono text-[#808080]">
            <Command className="w-3 h-3" />
            K
          </div>
        </div>

        {/* Command List Results */}
        <div className="p-2 max-h-80 overflow-y-auto space-y-1">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#808080]">
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
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${
                    isSelected ? "bg-[#202020] text-white" : "text-[#C5C5C5] hover:bg-[#1A1A1A]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isSelected ? "bg-[#7C3AED] text-white" : "bg-[#1A1A1A] text-[#808080]"}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">{item.title}</div>
                      {item.subtitle && (
                        <div className="text-[11px] text-[#808080]">{item.subtitle}</div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="flex items-center gap-1 text-[11px] text-[#7C3AED] font-bold">
                      <span>Jump</span>
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2 border-t border-[#2B2B2B] bg-[#0A0A0A] flex items-center justify-between text-[11px] text-[#808080]">
          <span>Use <kbd className="text-white font-mono">↑</kbd> <kbd className="text-white font-mono">↓</kbd> to navigate</span>
          <span>Press <kbd className="text-white font-mono">↵</kbd> to select</span>
        </div>

      </DialogContent>
    </Dialog>
  );
}
