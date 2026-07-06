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
  Plus, Search, Clock, Users, Settings, Trash2, MoreHorizontal,
  FolderPlus, Edit2, ShieldCheck, Check, Globe, Server, Database,
  Briefcase
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/CommandPalette";

export type DashboardTab = "recent" | "shared" | "settings";

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useUser();

  // Workspaces Data
  const workspaces = useQuery(api.workspaces.listMyWorkspaces);
  const createWorkspace = useMutation(api.workspaces.create);
  
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<Id<"workspaces"> | null>(null);

  React.useEffect(() => {
    if (workspaces && workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0]._id);
    }
  }, [workspaces, activeWorkspaceId]);

  // Slates Data
  const slates = useQuery(api.slates.list, activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip");
  const createSlate = useMutation(api.slates.create);
  const removeSlate = useMutation(api.slates.remove);
  const renameSlate = useMutation(api.slates.rename);

  const [activeTab, setActiveTab] = React.useState<DashboardTab>("recent");
  const [searchQuery, setSearchQuery] = React.useState("");
  
  // Modals
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = React.useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = React.useState("");

  const [renameId, setRenameId] = React.useState<Id<"slates"> | null>(null);
  const [renameTitleText, setRenameTitleText] = React.useState("");

  const getRandomIcon = () => {
    return (Math.floor(Math.random() * 5) + 1).toString();
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    try {
      const id = await createWorkspace({ name: newWorkspaceName.trim() });
      setActiveWorkspaceId(id);
      setIsCreateWorkspaceOpen(false);
      setNewWorkspaceName("");
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !activeWorkspaceId) return;

    setIsCreating(true);
    try {
      const id = await createSlate({
        title: newTitle.trim(),
        workspaceId: activeWorkspaceId,
        thumbnailIcon: getRandomIcon(),
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

  const handleRenameSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameId || !renameTitleText.trim()) return;
    try {
      await renameSlate({ id: renameId, title: renameTitleText.trim() });
      setRenameId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const filteredSlates = (slates || []).filter((s) => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen w-screen bg-[#0A0A0A] text-black font-sans selection:bg-[#ffffff]/30 select-none overflow-hidden">
      
      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => {}}
        onGoDashboard={() => setActiveTab("recent")}
        onAiGenerate={() => {}}
      />

      {/* LEFT SIDEBAR */}
      <aside className="w-64 h-full border-r border-[#2B2B2B] bg-[#101010] flex flex-col justify-between shrink-0 p-4">
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="Slate" width={26} height={26} className="rounded-lg shadow-sm" />
              <div>
                <h2 className="font-bold text-xs tracking-tight text-white leading-tight">
                  {user?.fullName ? `${user.fullName}'s Slate` : "Slate Workspace"}
                </h2>
              </div>
            </Link>
          </div>

          <div className="space-y-2">
            <label className="px-3 text-[10px] font-bold text-[#808080] uppercase tracking-wider">
              Workspaces
            </label>
            <div className="space-y-1 max-h-40 overflow-y-auto px-1">
              {workspaces?.map((w) => (
                <button
                  key={w._id}
                  onClick={() => setActiveWorkspaceId(w._id)}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeWorkspaceId === w._id
                      ? "bg-[#202020] text-white border border-[#2B2B2B]"
                      : "text-[#C5C5C5] hover:bg-[#1A1A1A] hover:text-white border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Briefcase className="w-3.5 h-3.5 text-[#808080]" />
                    <span className="truncate">{w.name}</span>
                  </div>
                </button>
              ))}
              
              <button
                onClick={() => setIsCreateWorkspaceOpen(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-[#808080] hover:text-white hover:bg-[#1A1A1A] transition-all cursor-pointer mt-2"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Workspace</span>
              </button>
            </div>
          </div>

          <nav className="space-y-1 mt-6">
            <button
              onClick={() => setActiveTab("recent")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "recent" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#C5C5C5] hover:bg-[#1A1A1A]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#808080]" />
                <span>Slates</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "settings" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#C5C5C5] hover:bg-[#1A1A1A]"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4 text-[#808080]" />
                <span>Settings & Members</span>
              </div>
            </button>
          </nav>
        </div>

        <div className="pt-4 border-t border-[#2B2B2B] flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <UserButton />
            <div className="truncate">
              <p className="text-xs font-bold text-white truncate">{user?.fullName || "Developer"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* RIGHT MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0A0A0A]">
        
        <header className="h-16 border-b border-[#2B2B2B] bg-[#0A0A0A] px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-white tracking-tight uppercase">
              {activeTab === "recent" && "Workspace Slates"}
              {activeTab === "settings" && "Workspace Settings"}
            </h1>
          </div>

          {activeTab === "recent" && (
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#808080] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter boards..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs text-white placeholder-[#666666] outline-none w-56 focus:border-[#ffffff] transition-colors"
                />
              </div>

              <Button
                onClick={() => setIsCreateOpen(true)}
                className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-9 px-4 flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4" />
                New Board
              </Button>
            </div>
          )}
        </header>

        <div className="flex-1 p-8 overflow-y-auto space-y-8">
          {activeTab === "recent" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#808080]">
                  Active Workspace Slates
                </h3>
              </div>

              {filteredSlates.length === 0 ? (
                <div className="p-16 text-center rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white">No Slates Found</h4>
                    <p className="text-xs text-[#808080]">Create your first infinite whiteboard canvas.</p>
                  </div>
                  <Button onClick={() => setIsCreateOpen(true)} className="bg-white text-black rounded-xl">
                    Create New Slate
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredSlates.map((slate) => (
                    <div key={slate._id} className="group rounded-2xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] transition-all flex flex-col justify-between overflow-hidden relative shadow-sm">
                      <Link href={`/canvas/${slate._id}`} className="h-52 border-b border-[#2B2B2B] flex items-center justify-center bg-white">
                        <Image
                          src={['1','2','3','4','5'].includes(slate.thumbnailIcon) ? `/illustration_${slate.thumbnailIcon}.svg` : '/illustration_1.svg'}
                          alt="Slate" fill className="object-cover opacity-90 group-hover:scale-105 transition-transform duration-500"
                        />
                      </Link>

                      <div className="p-4 flex items-center justify-between">
                        <Link href={`/canvas/${slate._id}`} className="space-y-0.5 overflow-hidden pr-2">
                          <h4 className="text-xs font-bold text-white truncate">{slate.title}</h4>
                          <p className="text-[11px] text-[#808080] font-mono">Edited {new Date(slate.lastEdited).toLocaleDateString()}</p>
                        </Link>
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger className="p-1.5 rounded-lg text-[#808080] hover:text-white transition-colors outline-none cursor-pointer">
                            <MoreHorizontal className="w-4 h-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-[#101010] border-[#2B2B2B] text-white">
                            <DropdownMenuItem onClick={() => { setRenameId(slate._id); setRenameTitleText(slate.title); }} className="text-xs cursor-pointer">
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => removeSlate({ id: slate._id })} className="text-xs text-rose-400 cursor-pointer">
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#ffffff]" />
                Workspace Settings & Members
              </h3>
              <p className="text-xs text-[#808080]">Manage workspace name, members, and sharing.</p>
              
              <div className="pt-4 border-t border-[#2B2B2B]">
                <p className="text-sm text-white">Sharing UI to be integrated with ShareDialog component...</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* RENAME SLATE DIALOG */}
      {renameId && (
        <Dialog open={!!renameId} onOpenChange={() => setRenameId(null)}>
          <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-sm rounded-2xl p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-base font-bold">Rename Slate</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRenameSlate} className="space-y-4">
              <input type="text" value={renameTitleText} onChange={(e) => setRenameTitleText(e.target.value)} className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-[#ffffff]" />
              <div className="flex justify-end gap-2">
                <Button type="submit" className="bg-white text-black text-xs h-10 px-4">Save</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* CREATE SLATE DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-bold">Create Slate</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSlate} className="space-y-4">
            <input required type="text" placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-[#ffffff]" />
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={isCreating} className="bg-white text-black text-xs h-10 px-5">{isCreating ? "Creating..." : "Create"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE WORKSPACE DIALOG */}
      <Dialog open={isCreateWorkspaceOpen} onOpenChange={setIsCreateWorkspaceOpen}>
        <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg font-bold">New Workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <input required type="text" placeholder="Workspace Name" value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-[#ffffff]" />
            <div className="flex justify-end gap-2">
              <Button type="submit" className="bg-white text-black text-xs h-10 px-5">Create Workspace</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
