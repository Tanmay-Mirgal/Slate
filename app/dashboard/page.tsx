"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useUser, UserButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Doc } from "@/convex/_generated/dataModel";

import {
  Plus, Search, Clock, Settings, Trash2, MoreHorizontal,
  Briefcase, Pencil
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/CommandPalette";

export type DashboardTab = "recent" | "settings";

const CARD_ACCENTS = [
  { border: "border-violet-500/40", gradient: "from-violet-900/30 to-purple-900/10", dot: "bg-violet-400", stripe: "from-violet-500 to-purple-600" },
  { border: "border-sky-500/40",    gradient: "from-sky-900/30 to-blue-900/10",     dot: "bg-sky-400",    stripe: "from-sky-500 to-blue-600"    },
  { border: "border-emerald-500/40",gradient: "from-emerald-900/30 to-green-900/10",dot: "bg-emerald-400",stripe: "from-emerald-500 to-green-600"},
  { border: "border-amber-500/40",  gradient: "from-amber-900/30 to-orange-900/10", dot: "bg-amber-400",  stripe: "from-amber-500 to-orange-600" },
  { border: "border-rose-500/40",   gradient: "from-rose-900/30 to-pink-900/10",    dot: "bg-rose-400",   stripe: "from-rose-500 to-pink-600"    },
  { border: "border-cyan-500/40",   gradient: "from-cyan-900/30 to-teal-900/10",    dot: "bg-cyan-400",   stripe: "from-cyan-500 to-teal-600"    },
];

function getAccent(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return CARD_ACCENTS[Math.abs(hash) % CARD_ACCENTS.length];
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useUser();

  const workspaces = useQuery(api.workspaces.listMyWorkspaces);
  const createWorkspace = useMutation(api.workspaces.create);
  const renameWorkspace = useMutation(api.workspaces.renameWorkspace);
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<Id<"workspaces"> | null>(null);

  React.useEffect(() => {
    if (workspaces && workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0]._id as Id<"workspaces">);
    }
  }, [workspaces, activeWorkspaceId]);

  const slates = useQuery(api.slates.list, activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip");
  const createSlate = useMutation(api.slates.create);
  const removeSlate = useMutation(api.slates.remove);
  const renameSlate = useMutation(api.slates.rename);

  const [activeTab, setActiveTab] = React.useState<DashboardTab>("recent");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = React.useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = React.useState("");

  // Inline slate rename
  const [editingSlateId, setEditingSlateId] = React.useState<Id<"slates"> | null>(null);
  const [editingSlateText, setEditingSlateText] = React.useState("");
  const slateInputRef = React.useRef<HTMLInputElement>(null);

  // Inline workspace rename
  const [editingWorkspaceId, setEditingWorkspaceId] = React.useState<Id<"workspaces"> | null>(null);
  const [editingWorkspaceText, setEditingWorkspaceText] = React.useState("");
  const workspaceInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (editingSlateId && slateInputRef.current) slateInputRef.current.focus(); }, [editingSlateId]);
  React.useEffect(() => { if (editingWorkspaceId && workspaceInputRef.current) workspaceInputRef.current.focus(); }, [editingWorkspaceId]);

  const getRandomIcon = () => (Math.floor(Math.random() * 5) + 1).toString();

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    try {
      const id = await createWorkspace({ name: newWorkspaceName.trim() });
      setActiveWorkspaceId(id);
      setIsCreateWorkspaceOpen(false);
      setNewWorkspaceName("");
    } catch (err) { console.error(err); }
  };

  const handleCreateSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !activeWorkspaceId) return;
    setIsCreating(true);
    try {
      const id = await createSlate({ title: newTitle.trim(), workspaceId: activeWorkspaceId, thumbnailIcon: getRandomIcon() });
      setIsCreateOpen(false);
      setNewTitle("");
      router.push(`/canvas/${id}`);
    } catch (err) { console.error(err); }
    finally { setIsCreating(false); }
  };

  const commitSlateRename = async () => {
    if (!editingSlateId || !editingSlateText.trim()) { setEditingSlateId(null); return; }
    try { await renameSlate({ id: editingSlateId, title: editingSlateText.trim() }); }
    catch (err) { console.error(err); }
    finally { setEditingSlateId(null); }
  };

  const commitWorkspaceRename = async () => {
    if (!editingWorkspaceId || !editingWorkspaceText.trim()) { setEditingWorkspaceId(null); return; }
    try { await renameWorkspace({ id: editingWorkspaceId, name: editingWorkspaceText.trim() }); }
    catch (err) { console.error(err); }
    finally { setEditingWorkspaceId(null); }
  };

  const filteredSlates = (slates || []).filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen w-screen bg-[#0A0A0A] text-white font-sans selection:bg-white/20 select-none overflow-hidden">

      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => setIsCreateOpen(true)}
        onGoDashboard={() => setActiveTab("recent")}
        onAiGenerate={() => {}}
      />

      {/* SIDEBAR */}
      <aside className="w-64 h-full border-r border-[#2B2B2B] bg-[#101010] flex flex-col justify-between shrink-0 p-4">
        <div className="space-y-6">
          <div className="flex items-center px-2">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="Slate" width={26} height={26} className="rounded-lg shadow-sm" />
              <h2 className="font-bold text-xs tracking-tight text-white leading-tight">
                {user?.fullName ? `${user.fullName}'s Slate` : "Slate Workspace"}
              </h2>
            </Link>
          </div>

          <div className="space-y-2">
            <label className="px-3 text-[10px] font-bold text-[#808080] uppercase tracking-wider">Workspaces</label>
            <div className="space-y-1 max-h-48 overflow-y-auto px-1">
              {workspaces?.map((w: any) => (
                <div key={w._id} className="group relative">
                  {editingWorkspaceId === w._id ? (
                    <input
                      ref={workspaceInputRef}
                      value={editingWorkspaceText}
                      onChange={(e) => setEditingWorkspaceText(e.target.value)}
                      onBlur={commitWorkspaceRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitWorkspaceRename();
                        if (e.key === "Escape") setEditingWorkspaceId(null);
                      }}
                      className="w-full px-2 py-1.5 rounded-lg border border-white bg-[#202020] text-xs font-semibold text-white outline-none"
                    />
                  ) : (
                    <div className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeWorkspaceId === w._id
                        ? "bg-[#202020] text-white border border-[#2B2B2B]"
                        : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
                    }`}>
                      <button onClick={() => setActiveWorkspaceId(w._id as Id<"workspaces">)} className="flex items-center gap-2 truncate flex-1 cursor-pointer">
                        <Briefcase className="w-3.5 h-3.5 text-[#808080] shrink-0" />
                        <span className="truncate">{w.name}</span>
                      </button>
                      <button
                        onClick={() => { setEditingWorkspaceId(w._id as Id<"workspaces">); setEditingWorkspaceText(w.name); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[#808080] hover:text-white shrink-0"
                        title="Rename workspace"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={() => setIsCreateWorkspaceOpen(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-[#808080] hover:text-white hover:bg-[#1A1A1A] transition-all cursor-pointer mt-1"
              >
                <Plus className="w-3.5 h-3.5" /><span>New Workspace</span>
              </button>
            </div>
          </div>

          <nav className="space-y-1">
            {(["recent", "settings"] as DashboardTab[]).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === tab ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#C5C5C5] hover:bg-[#1A1A1A] border border-transparent"
                }`}>
                {tab === "recent" ? <Clock className="w-4 h-4 text-[#808080]" /> : <Settings className="w-4 h-4 text-[#808080]" />}
                <span>{tab === "recent" ? "Slates" : "Settings & Members"}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-4 border-t border-[#2B2B2B] flex items-center gap-2.5 px-2">
          <UserButton />
          <p className="text-xs font-bold text-white truncate">{user?.fullName || "Developer"}</p>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0A0A0A]">
        <header className="h-16 border-b border-[#2B2B2B] px-8 flex items-center justify-between shrink-0">
          <h1 className="text-sm font-bold text-white tracking-tight uppercase">
            {activeTab === "recent" ? "Workspace Slates" : "Workspace Settings"}
          </h1>
          {activeTab === "recent" && (
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#808080] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Filter boards..." value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs text-white placeholder-[#666] outline-none w-56 focus:border-white transition-colors" />
              </div>
              <Button onClick={() => setIsCreateOpen(true)}
                className="rounded-xl bg-white hover:bg-[#e5e5e5] text-black text-xs font-semibold h-9 px-4 flex items-center gap-1.5 cursor-pointer shadow-sm">
                <Plus className="w-4 h-4" /> New Board
              </Button>
            </div>
          )}
        </header>

        <div className="flex-1 p-8 overflow-y-auto">
          {activeTab === "recent" && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#808080]">Active Workspace Slates</h3>
              {filteredSlates.length === 0 ? (
                <div className="p-16 text-center rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4">
                  <h4 className="text-sm font-bold text-white">No Slates Found</h4>
                  <p className="text-xs text-[#808080]">Create your first infinite whiteboard canvas.</p>
                  <Button onClick={() => setIsCreateOpen(true)} className="bg-white text-black rounded-xl">Create New Slate</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredSlates.map((slate) => {
                    const accent = getAccent(slate._id);
                    return (
                      <div key={slate._id}
                        className={`group rounded-2xl border ${accent.border} bg-[#141414] hover:bg-[#181818] transition-all flex flex-col overflow-hidden shadow-md hover:shadow-lg hover:shadow-black/40`}>

                        {/* Thumbnail */}
                        <Link href={`/canvas/${slate._id}`}
                          className={`relative h-48 flex items-center justify-center bg-gradient-to-br ${accent.gradient} overflow-hidden border-b ${accent.border}`}>
                          {/* Top accent stripe */}
                          <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${accent.stripe}`} />
                          <Image
                            src={['1','2','3','4','5'].includes(slate.thumbnailIcon) ? `/illustration_${slate.thumbnailIcon}.svg` : '/illustration_1.svg'}
                            alt="Slate" fill
                            className="object-cover opacity-75 group-hover:scale-105 transition-transform duration-500 mix-blend-luminosity"
                          />
                        </Link>

                        {/* Footer */}
                        <div className="p-4 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${accent.dot}`} />
                            <div className="min-w-0 flex-1">
                              {editingSlateId === slate._id ? (
                                <input
                                  ref={slateInputRef}
                                  value={editingSlateText}
                                  onChange={(e) => setEditingSlateText(e.target.value)}
                                  onBlur={commitSlateRename}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitSlateRename();
                                    if (e.key === "Escape") setEditingSlateId(null);
                                  }}
                                  onClick={(e) => e.preventDefault()}
                                  className="w-full bg-[#202020] border border-white/30 rounded-md px-2 py-0.5 text-xs font-bold text-white outline-none"
                                />
                              ) : (
                                <h4
                                  className="text-xs font-bold text-white truncate cursor-text hover:text-white/80 transition-colors"
                                  onDoubleClick={() => { setEditingSlateId(slate._id); setEditingSlateText(slate.title); }}
                                  title="Double-click to rename"
                                >
                                  {slate.title}
                                </h4>
                              )}
                              <p className="text-[11px] text-[#808080] font-mono mt-0.5">
                                Edited {new Date(slate.lastEdited).toLocaleDateString()}
                              </p>
                            </div>
                          </div>

                          <DropdownMenu>
                            <DropdownMenuTrigger className="p-1.5 rounded-lg text-[#808080] hover:text-white transition-colors outline-none cursor-pointer shrink-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="bg-[#101010] border-[#2B2B2B] text-white">
                              <DropdownMenuItem
                                onClick={() => { setEditingSlateId(slate._id); setEditingSlateText(slate.title); }}
                                className="text-xs cursor-pointer flex items-center gap-2">
                                <Pencil className="w-3.5 h-3.5" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => removeSlate({ id: slate._id })}
                                className="text-xs text-rose-400 cursor-pointer flex items-center gap-2">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5" /> Workspace Settings &amp; Members
              </h3>
              <p className="text-xs text-[#808080]">Manage workspace name, members, and sharing.</p>
              <div className="pt-4 border-t border-[#2B2B2B]">
                <p className="text-sm text-white">Sharing UI to be integrated with ShareDialog component...</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* CREATE SLATE */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
          <DialogHeader className="mb-4"><DialogTitle className="text-lg font-bold">Create Slate</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateSlate} className="space-y-4">
            <input required type="text" placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-white" />
            <div className="flex justify-end">
              <Button type="submit" disabled={isCreating} className="bg-white text-black text-xs h-10 px-5">
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE WORKSPACE */}
      <Dialog open={isCreateWorkspaceOpen} onOpenChange={setIsCreateWorkspaceOpen}>
        <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
          <DialogHeader className="mb-4"><DialogTitle className="text-lg font-bold">New Workspace</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <input required type="text" placeholder="Workspace Name" value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)}
              className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-white" />
            <div className="flex justify-end">
              <Button type="submit" className="bg-white text-black text-xs h-10 px-5">Create Workspace</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
