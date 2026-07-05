"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useUser, UserButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import {
  Plus,
  Search,
  Layout,
  Clock,
  Star,
  Users,
  Settings,
  Trash2,
  MoreHorizontal,
  FolderPlus,
  Sparkles,
  Database,
  Server,
  Cpu,
  Globe,
  HardDrive,
  Check,
  Edit2,
  Command,
  Bell,
  Layers,
  FileText,
  ChevronRight,
  ShieldCheck
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/CommandPalette";

export type DashboardTab = "recent" | "favorites" | "shared" | "templates" | "settings";

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useUser();

  // Convex Queries & Mutations
  const slates = useQuery(api.slates.list);
  const createSlate = useMutation(api.slates.create);
  const removeSlate = useMutation(api.slates.remove);
  const renameSlate = useMutation(api.slates.rename);

  // UI State
  const [activeTab, setActiveTab] = React.useState<DashboardTab>("recent");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [selectedIcon, setSelectedIcon] = React.useState("Database");
  const [isCreating, setIsCreating] = React.useState(false);

  // Rename Dialog State
  const [renameId, setRenameId] = React.useState<Id<"slates"> | null>(null);
  const [renameTitleText, setRenameTitleText] = React.useState("");

  const icons = [
    { name: "Database", icon: Database },
    { name: "Server", icon: Server },
    { name: "Cpu", icon: Cpu },
    { name: "Globe", icon: Globe },
    { name: "HardDrive", icon: HardDrive },
  ];

  // Handle New Slate Creation
  const handleCreateSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsCreating(true);
    try {
      const id = await createSlate({
        title: newTitle.trim(),
        thumbnailIcon: selectedIcon,
      });
      setIsCreateOpen(false);
      setNewTitle("");
      router.push(`/canvas/${id}`);
    } catch (error) {
      console.error("Failed to create slate:", error);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Rename Slate
  const handleRenameSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameId || !renameTitleText.trim()) return;
    try {
      await renameSlate({ id: renameId, title: renameTitleText.trim() });
      setRenameId(null);
    } catch (e) {
      console.error("Failed renaming slate", e);
    }
  };

  // Filter slates based on searchQuery & activeTab
  const filteredSlates = (slates || []).filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeTab === "shared") return matchesSearch && s.isShared;
    return matchesSearch;
  });

  return (
    <div className="flex h-screen w-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#7C3AED]/30 select-none overflow-hidden">
      
      {/* Raycast Command Palette Modal */}
      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => setIsCreateOpen(true)}
      />

      {/* LEFT SIDEBAR (#101010) */}
      <aside className="w-64 h-full border-r border-[#2B2B2B] bg-[#101010] flex flex-col justify-between shrink-0 p-4">
        
        <div className="space-y-6">
          {/* Workspace Switcher Header */}
          <div className="flex items-center justify-between px-2">
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/logo.png"
                alt="Slate Logo"
                width={26}
                height={26}
                className="rounded-lg shadow-sm"
              />
              <div>
                <h2 className="font-bold text-xs tracking-tight text-white leading-tight">
                  {user?.fullName ? `${user.fullName}'s Slate` : "Slate Workspace"}
                </h2>
                <p className="text-[10px] text-[#808080]">Pro Plan — 5 Members</p>
              </div>
            </Link>
          </div>

          {/* Quick Search Button (Raycast Trigger) */}
          <button
            onClick={() => setIsCommandOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#808080] hover:text-white hover:border-[#333333] transition-all cursor-pointer shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-[#808080]" />
              <span>Search...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded border border-[#2B2B2B] bg-[#1A1A1A] text-[10px] font-mono text-[#C5C5C5]">
              Ctrl K
            </kbd>
          </button>

          {/* Navigation Section Items */}
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab("recent")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "recent"
                  ? "bg-[#202020] text-white border border-[#2B2B2B]"
                  : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#808080]" />
                <span>Recent Slates</span>
              </div>
              <span className="text-[10px] font-mono text-[#808080]">{slates?.length || 0}</span>
            </button>

            <button
              onClick={() => setActiveTab("shared")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "shared"
                  ? "bg-[#202020] text-white border border-[#2B2B2B]"
                  : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-[#808080]" />
                <span>Shared with me</span>
              </div>
              <span className="text-[10px] font-mono text-[#808080]">
                {slates?.filter((s) => s.isShared).length || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("favorites")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "favorites"
                  ? "bg-[#202020] text-white border border-[#2B2B2B]"
                  : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Star className="w-4 h-4 text-[#808080]" />
                <span>Favorites</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("templates")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "templates"
                  ? "bg-[#202020] text-white border border-[#2B2B2B]"
                  : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Layout className="w-4 h-4 text-[#808080]" />
                <span>Architecture Templates</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "settings"
                  ? "bg-[#202020] text-white border border-[#2B2B2B]"
                  : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4 text-[#808080]" />
                <span>Workspace Settings</span>
              </div>
            </button>
          </nav>

          {/* Storage Capacity Bar */}
          <div className="p-3 rounded-xl border border-[#2B2B2B] bg-[#141414] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-white">Storage Used</span>
              <span className="text-[#808080] font-mono">1.2 GB / 10 GB</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#1A1A1A] overflow-hidden">
              <div className="h-full bg-[#7C3AED] rounded-full w-12" />
            </div>
          </div>
        </div>

        {/* User Account Bar */}
        <div className="pt-4 border-t border-[#2B2B2B] flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <UserButton afterSignOutUrl="/" />
            <div className="truncate">
              <p className="text-xs font-bold text-white truncate">{user?.fullName || "Developer"}</p>
              <p className="text-[10px] text-[#808080] truncate">{user?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* RIGHT MAIN CONTENT AREA (#0A0A0A) */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0A0A0A]">
        
        {/* TOP NAVBAR */}
        <header className="h-16 border-b border-[#2B2B2B] bg-[#0A0A0A] px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-white tracking-tight uppercase">
              {activeTab === "recent" && "Recent Slates"}
              {activeTab === "shared" && "Shared With Me"}
              {activeTab === "favorites" && "Favorite Slates"}
              {activeTab === "templates" && "Architecture Templates"}
              {activeTab === "settings" && "Workspace Settings"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            
            {/* Filter Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#808080] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter boards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-1.5 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs text-white placeholder-[#666666] outline-none w-56 focus:border-[#7C3AED] transition-colors font-sans"
              />
            </div>

            {/* CREATE NEW SLATE DIALOG */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger className="h-10 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition-all cursor-pointer">
                <Plus className="w-4 h-4" />
                New Slate
              </DialogTrigger>
              <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <FolderPlus className="w-5 h-5 text-[#7C3AED]" />
                    Create Architecture Slate
                  </DialogTitle>
                  <DialogDescription className="text-xs text-[#808080]">
                    Start a new collaborative infinite whiteboard and documentation canvas.
                  </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleCreateSlate} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#C5C5C5]">Slate Title</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Microservice Architecture LLD"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white placeholder-[#666666] outline-none focus:border-[#7C3AED] transition-colors font-sans"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#C5C5C5]">Thumbnail Icon</label>
                    <div className="grid grid-cols-5 gap-2">
                      {icons.map((item) => {
                        const IconComp = item.icon;
                        const isSel = selectedIcon === item.name;
                        return (
                          <button
                            type="button"
                            key={item.name}
                            onClick={() => setSelectedIcon(item.name)}
                            className={`p-3 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                              isSel
                                ? "border-[#7C3AED] bg-[#7C3AED]/20 text-[#7C3AED]"
                                : "border-[#2B2B2B] bg-[#141414] text-[#808080] hover:text-white hover:bg-[#1A1A1A]"
                            }`}
                          >
                            <IconComp className="w-5 h-5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-3 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setIsCreateOpen(false)}
                      className="rounded-xl text-xs font-semibold text-[#808080] hover:text-white cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isCreating}
                      className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white text-xs font-semibold h-10 px-5 cursor-pointer"
                    >
                      {isCreating ? "Creating..." : "Create Slate"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

          </div>
        </header>

        {/* DASHBOARD CONTENT BODY */}
        <div className="flex-1 p-8 overflow-y-auto space-y-8">
          
          {/* Welcome Header */}
          <div className="flex items-center justify-between p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414]">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Welcome back, {user?.firstName || "Developer"} 👋
              </h2>
              <p className="text-xs text-[#808080] mt-1">
                Collaborate on system designs, architecture nodes, and Notion documentation in real-time.
              </p>
            </div>
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white text-xs font-semibold h-10 px-4 flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Board
            </Button>
          </div>

          {/* SLATES GRID SECTION */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#808080]">
                {activeTab === "recent" && "Continue Working"}
                {activeTab === "shared" && "Shared Architecture Boards"}
                {activeTab === "favorites" && "Pinned Boards"}
                {activeTab === "templates" && "Ready-to-use Architecture Templates"}
              </h3>
              <span className="text-xs text-[#808080] font-mono">
                {filteredSlates.length} {filteredSlates.length === 1 ? "board" : "boards"}
              </span>
            </div>

            {/* Empty State */}
            {filteredSlates.length === 0 ? (
              <div className="p-16 text-center rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4">
                <div className="p-4 rounded-2xl bg-[#1A1A1A] text-[#7C3AED] w-fit mx-auto">
                  <Layout className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">No Slates Found</h4>
                  <p className="text-xs text-[#808080] max-w-sm mx-auto">
                    Create your first infinite whiteboard canvas to start mapping architecture and writing docs.
                  </p>
                </div>
                <Button
                  onClick={() => setIsCreateOpen(true)}
                  className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white text-xs font-semibold h-10 px-4 cursor-pointer"
                >
                  Create New Slate
                </Button>
              </div>
            ) : (
              /* Slates Grid Cards (16px Radius, #2B2B2B Border, #202020 Hover) */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredSlates.map((slate) => (
                  <div
                    key={slate._id}
                    className="group rounded-2xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#333333] transition-all cursor-pointer flex flex-col justify-between overflow-hidden relative shadow-sm"
                  >
                    {/* Top Thumbnail Canvas Preview */}
                    <Link href={`/canvas/${slate._id}`} className="p-5 h-36 bg-[#0D0D0D] border-b border-[#2B2B2B] flex items-center justify-center relative group-hover:bg-[#101010] transition-colors">
                      <div className="p-3 rounded-2xl bg-[#141414] border border-[#2B2B2B] text-[#7C3AED] group-hover:scale-110 transition-transform">
                        {slate.thumbnailIcon === "Server" ? (
                          <Server className="w-7 h-7" />
                        ) : slate.thumbnailIcon === "Cpu" ? (
                          <Cpu className="w-7 h-7" />
                        ) : slate.thumbnailIcon === "Globe" ? (
                          <Globe className="w-7 h-7" />
                        ) : (
                          <Database className="w-7 h-7" />
                        )}
                      </div>
                      
                      {/* Shared Badge */}
                      {slate.isShared && (
                        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-[#7C3AED] text-[10px] font-bold">
                          Shared
                        </div>
                      )}
                    </Link>

                    {/* Bottom Metadata Bar */}
                    <div className="p-4 flex items-center justify-between">
                      <Link href={`/canvas/${slate._id}`} className="space-y-0.5 overflow-hidden pr-2">
                        <h4 className="text-xs font-bold text-white truncate group-hover:text-[#7C3AED] transition-colors">
                          {slate.title}
                        </h4>
                        <p className="text-[11px] text-[#808080] font-mono">
                          Edited {new Date(slate.lastEdited).toLocaleDateString()}
                        </p>
                      </Link>

                      {/* Options Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger className="p-1.5 rounded-lg text-[#808080] hover:text-white hover:bg-[#202020] transition-colors cursor-pointer outline-none">
                          <MoreHorizontal className="w-4 h-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-[#101010] border-[#2B2B2B] text-white">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameId(slate._id);
                              setRenameTitleText(slate.title);
                            }}
                            className="text-xs hover:bg-[#202020] cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5 mr-2 text-[#C5C5C5]" />
                            Rename Slate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => removeSlate({ id: slate._id })}
                            className="text-xs text-rose-400 hover:bg-[#202020] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Delete Slate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>

      {/* RENAME SLATE DIALOG */}
      {renameId && (
        <Dialog open={!!renameId} onOpenChange={() => setRenameId(null)}>
          <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-sm rounded-2xl p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-base font-bold text-white">Rename Slate</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRenameSlate} className="space-y-4">
              <input
                type="text"
                required
                value={renameTitleText}
                onChange={(e) => setRenameTitleText(e.target.value)}
                className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-[#7C3AED] font-sans"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRenameId(null)}
                  className="rounded-xl text-xs font-semibold text-[#808080] hover:text-white cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white text-xs font-semibold h-10 px-4 cursor-pointer"
                >
                  Save Title
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
