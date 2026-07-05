"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useUser, UserButton } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { 
  Plus, 
  FileText, 
  Settings, 
  Layout, 
  LogOut, 
  Clock, 
  Users, 
  HardDrive, 
  Search, 
  Grid, 
  List, 
  ArrowRight,
  MoreVertical,
  Activity,
  UserCheck,
  Trash2,
  Edit2,
  Share2,
  Moon,
  Sun,
  ShieldAlert,
  Loader2,
  Globe,
  Paintbrush
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export default function DashboardPage() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const slates = useQuery(api.slates.list);

  // Mutations
  const createSlate = useMutation(api.slates.create);
  const renameSlate = useMutation(api.slates.rename);
  const deleteSlate = useMutation(api.slates.remove);
  const toggleShareSlate = useMutation(api.slates.toggleShare);

  // State
  const [activeTab, setActiveTab] = React.useState<"all" | "recent" | "shared" | "settings">("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [selectedEmoji, setSelectedEmoji] = React.useState("📐");

  // Rename Dialog State
  const [isRenameOpen, setIsRenameOpen] = React.useState(false);
  const [renameTitle, setRenameTitle] = React.useState("");
  const [renameId, setRenameId] = React.useState<string | null>(null);

  // Profile preferences (simulated settings)
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const [displayName, setDisplayName] = React.useState("");

  React.useEffect(() => {
    if (user?.firstName) {
      setDisplayName(user.firstName);
    }
  }, [user]);

  const firstName = user?.firstName || "Creator";
  const emailAddress = user?.emailAddresses?.[0]?.emailAddress || "creator@slate.com";

  // Emoji options for thumbnails
  const emojiOptions = ["📐", "💡", "💾", "🗺️", "🧠", "📝", "📊", "🎨", "🚀", "💻"];

  // Filtered Slates based on search query
  const filteredSlates = slates?.filter((s) => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Recents (limit to 3, sorted by default from query)
  const recentSlates = filteredSlates.slice(0, 3);

  // Shared (isShared === true)
  const sharedSlates = filteredSlates.filter((s) => s.isShared);

  // Handlers
  const handleCreateSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      await createSlate({
        title: newTitle,
        thumbnailIcon: selectedEmoji,
      });
      setNewTitle("");
      setIsCreateOpen(false);
    } catch (error) {
      console.error("Failed to create slate:", error);
    }
  };

  const handleRenameSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTitle.trim() || !renameId) return;

    try {
      await renameSlate({
        id: renameId as any,
        title: renameTitle,
      });
      setRenameTitle("");
      setRenameId(null);
      setIsRenameOpen(false);
    } catch (error) {
      console.error("Failed to rename slate:", error);
    }
  };

  const handleDeleteSlate = async (id: string) => {
    if (confirm("Are you sure you want to delete this slate?")) {
      try {
        await deleteSlate({ id: id as any });
      } catch (error) {
        console.error("Failed to delete slate:", error);
      }
    }
  };

  const handleToggleShare = async (id: string) => {
    try {
      await toggleShareSlate({ id: id as any });
    } catch (error) {
      console.error("Failed to toggle share:", error);
    }
  };

  const handleOpenRename = (id: string, currentTitle: string) => {
    setRenameId(id);
    setRenameTitle(currentTitle);
    setIsRenameOpen(true);
  };

  return (
    <div className={`flex h-screen overflow-hidden ${theme === "dark" ? "bg-neutral-950 text-neutral-100 dark" : "bg-neutral-50 text-neutral-900"}`}>
      
      {/* Sidebar */}
      <aside className={`w-64 border-r flex flex-col justify-between shrink-0 ${theme === "dark" ? "border-neutral-900 bg-neutral-950" : "border-neutral-200 bg-white"}`}>
        <div>
          <div className={`h-16 px-6 border-b flex items-center gap-2 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={36}
              height={36}
              className="rounded-md shadow-[0_0_10px_rgba(147,51,234,0.1)]"
            />
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              Slate
            </span>
            <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-[9px] font-bold text-purple-400 border border-purple-500/20">PRO</span>
          </div>

          {/* Navigation Links */}
          <div className="p-4 space-y-1.5">
            <button 
              onClick={() => setActiveTab("all")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                activeTab === "all" 
                  ? "bg-purple-600/10 text-purple-400 border border-purple-500/20" 
                  : `text-neutral-400 border border-transparent ${theme === "dark" ? "hover:text-white hover:bg-neutral-900" : "hover:text-neutral-950 hover:bg-neutral-100"}`
              }`}
            >
              <Layout className="w-4 h-4" />
              <span>All Slates</span>
            </button>

            <button 
              onClick={() => setActiveTab("recent")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                activeTab === "recent" 
                  ? "bg-purple-600/10 text-purple-400 border border-purple-500/20" 
                  : `text-neutral-400 border border-transparent ${theme === "dark" ? "hover:text-white hover:bg-neutral-900" : "hover:text-neutral-950 hover:bg-neutral-100"}`
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Recent</span>
            </button>

            <button 
              onClick={() => setActiveTab("shared")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                activeTab === "shared" 
                  ? "bg-purple-600/10 text-purple-400 border border-purple-500/20" 
                  : `text-neutral-400 border border-transparent ${theme === "dark" ? "hover:text-white hover:bg-neutral-900" : "hover:text-neutral-950 hover:bg-neutral-100"}`
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Shared with me</span>
            </button>

            <button 
              onClick={() => setActiveTab("settings")}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                activeTab === "settings" 
                  ? "bg-purple-600/10 text-purple-400 border border-purple-500/20" 
                  : `text-neutral-400 border border-transparent ${theme === "dark" ? "hover:text-white hover:bg-neutral-900" : "hover:text-neutral-950 hover:bg-neutral-100"}`
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* User Card */}
        <div className={`p-4 border-t ${theme === "dark" ? "border-neutral-900 bg-neutral-950/40" : "border-neutral-200 bg-neutral-50/50"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="ring-2 ring-purple-600/30 rounded-full shrink-0">
                <UserButton />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold truncate">{displayName || firstName}</p>
                <p className="text-[10px] text-neutral-500 truncate">{emailAddress}</p>
              </div>
            </div>
            <Link href="/" className={`p-2 rounded-xl hover:text-red-400 transition-colors ${theme === "dark" ? "hover:bg-neutral-900" : "hover:bg-neutral-100"}`}>
              <LogOut className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        
        {/* Top Navbar */}
        <header className={`h-16 px-8 border-b flex items-center justify-between sticky top-0 z-10 shrink-0 backdrop-blur-md ${theme === "dark" ? "border-neutral-900 bg-neutral-950/60" : "border-neutral-200 bg-white/60"}`}>
          
          {/* Search Bar */}
          <div className={`flex items-center gap-2.5 border px-3 py-2 rounded-xl w-96 ${theme === "dark" ? "bg-neutral-950 border-neutral-900" : "bg-neutral-100 border-neutral-200"}`}>
            <Search className="w-4 h-4 text-neutral-500" />
            <input 
              type="text" 
              placeholder="Search your slates..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-sm w-full outline-hidden placeholder-neutral-500 border-none p-0 focus:ring-0"
            />
          </div>

          <div className="flex items-center gap-4">
            {/* Storage Meter */}
            <div className={`hidden lg:flex items-center gap-3 text-xs border-r pr-4 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
              <HardDrive className="w-4 h-4 text-neutral-500" />
              <div className="space-y-1">
                <div className="flex justify-between font-bold">
                  <span>Storage Used</span>
                  <span>14%</span>
                </div>
                <div className={`w-24 h-1 rounded-full overflow-hidden ${theme === "dark" ? "bg-neutral-800" : "bg-neutral-200"}`}>
                  <div className="bg-purple-600 h-full w-[14%]" />
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-1.5 px-4.5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-sm font-bold text-white shadow-md hover:shadow-purple-600/20 hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer">
                  <Plus className="w-4 h-4" />
                  New Slate
                </Button>
              </DialogTrigger>
              <DialogContent className={`${theme === "dark" ? "bg-neutral-950 border-neutral-900 text-white" : "bg-white border-neutral-200 text-neutral-900"}`}>
                <form onSubmit={handleCreateSlate}>
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2">
                      <Paintbrush className="w-5 h-5 text-purple-500" />
                      Create New Slate
                    </DialogTitle>
                    <DialogDescription className="text-neutral-500">
                      An infinite digital canvas to draw, structure, and collaborate.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 mb-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Slate Title</label>
                      <Input 
                        placeholder="Untitled Slate" 
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className={`rounded-xl ${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-neutral-50 border-neutral-200 text-neutral-900"}`}
                        required
                        autoFocus
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider block">Choose Thumbnail Icon</label>
                      <div className="flex flex-wrap gap-2">
                        {emojiOptions.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setSelectedEmoji(emoji)}
                            className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg border transition-all cursor-pointer ${
                              selectedEmoji === emoji 
                                ? "border-purple-600 bg-purple-500/10 text-white" 
                                : `border-neutral-800 ${theme === "dark" ? "hover:bg-neutral-900" : "hover:bg-neutral-100"}`
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="mt-4 flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} className="rounded-xl cursor-pointer">
                      Cancel
                    </Button>
                    <Button type="submit" className="rounded-xl bg-purple-600 text-white hover:bg-purple-700 cursor-pointer">
                      Create Canvas
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 p-8 space-y-8 max-w-7xl w-full mx-auto">
          
          {/* Welcome Banner */}
          <div className={`relative rounded-3xl border p-6 overflow-hidden ${
            theme === "dark" 
              ? "border-purple-500/20 bg-gradient-to-r from-purple-500/10 via-indigo-500/5 to-transparent" 
              : "border-purple-200 bg-gradient-to-r from-purple-50 via-indigo-50/50 to-transparent"
          }`}>
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[80px] pointer-events-none" />
            
            <div className="max-w-2xl">
              <h1 className="text-2xl md:text-3xl font-black mb-2.5 tracking-tight">
                Welcome back, {displayName || firstName}! ✨
              </h1>
              <p className="text-neutral-400 text-sm leading-relaxed mb-4">
                Sketch designs, build database schema flowcharts, map out customer journeys, and invite teammates to work together in real-time.
              </p>
            </div>
            
            {/* Integration check banner */}
            <div className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full border text-[11px] font-semibold ${
              theme === "dark" 
                ? "bg-neutral-950 border-neutral-800 text-neutral-400" 
                : "bg-neutral-100 border-neutral-200 text-neutral-600"
            }`}>
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Clerk Auth: Connected as {emailAddress}</span>
            </div>
          </div>

          {/* RENAME SLATE DIALOG */}
          <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
            <DialogContent className={`${theme === "dark" ? "bg-neutral-950 border-neutral-900 text-white" : "bg-white border-neutral-200 text-neutral-900"}`}>
              <form onSubmit={handleRenameSlate}>
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-lg font-bold">Rename Slate</DialogTitle>
                  <DialogDescription className="text-neutral-500">
                    Change the title of your collaborative canvas.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mb-6">
                  <Input 
                    placeholder="New Title" 
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    className={`rounded-xl ${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-neutral-50 border-neutral-200 text-neutral-900"}`}
                    required
                    autoFocus
                  />
                </div>

                <DialogFooter className="mt-4 flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsRenameOpen(false)} className="rounded-xl cursor-pointer">
                    Cancel
                  </Button>
                  <Button type="submit" className="rounded-xl bg-purple-600 text-white hover:bg-purple-700 cursor-pointer">
                    Save Changes
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* DYNAMIC PAGES BASED ON ACTIVE TAB */}
          
          {/* TAB 1: ALL SLATES */}
          {activeTab === "all" && (
            <div className="space-y-6">
              {/* Slates Header */}
              <div className={`flex items-center justify-between border-b pb-3.5 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  <Layout className="w-5 h-5 text-purple-500" />
                  Your Whiteboards
                </h2>
                <div className="text-xs font-semibold text-neutral-400 bg-neutral-900 border border-neutral-800 px-3 py-1 rounded-lg">
                  {filteredSlates.length} {filteredSlates.length === 1 ? "Slate" : "Slates"}
                </div>
              </div>

              {/* Slates Cards Grid */}
              {!slates ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                  <p className="text-sm font-semibold text-neutral-400">Loading your canvases...</p>
                </div>
              ) : filteredSlates.length === 0 ? (
                <div className={`flex flex-col items-center justify-center py-20 text-center rounded-3xl border border-dashed p-8 ${
                  theme === "dark" ? "border-neutral-800 bg-neutral-950/20" : "border-neutral-300 bg-neutral-50/50"
                }`}>
                  <FileText className="w-12 h-12 text-neutral-600 mb-4" />
                  <h3 className="text-lg font-bold mb-2">No slates found</h3>
                  <p className="text-neutral-500 text-sm max-w-sm mb-6">
                    Create your first digital whiteboard to start sketching diagrams and collaborating in real-time.
                  </p>
                  <Button 
                    onClick={() => setIsCreateOpen(true)}
                    className="rounded-xl bg-purple-600 text-white hover:bg-purple-700 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    New Slate
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {filteredSlates.map((slate) => (
                    <Card 
                      key={slate._id} 
                      className={`group overflow-hidden rounded-2xl border transition-all duration-300 hover:shadow-xl relative flex flex-col justify-between ${
                        theme === "dark" 
                          ? "border-neutral-900 bg-neutral-950/40 hover:border-neutral-800" 
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      {/* Thumbnail preview */}
                      <div className={`h-36 relative flex items-center justify-center transition-opacity duration-300 border-b ${
                        theme === "dark" 
                          ? "bg-neutral-900/50 border-neutral-900 group-hover:bg-neutral-900/70" 
                          : "bg-neutral-100 border-neutral-200 group-hover:bg-neutral-100/70"
                      }`}>
                        <span className="text-4xl filter drop-shadow-md select-none">{slate.thumbnailIcon}</span>
                        
                        {/* Hover Overlay Button to go inside Canvas */}
                        <div className="absolute inset-0 bg-neutral-950/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                          <Button className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shadow-md cursor-pointer">
                            Open Canvas
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Header content & dropdown */}
                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-start justify-between gap-1.5">
                          <CardTitle className="text-sm font-bold truncate leading-tight group-hover:text-purple-400 transition-colors">
                            {slate.title}
                          </CardTitle>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" className="text-neutral-500 hover:text-white cursor-pointer">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className={`${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-white border-neutral-200 text-neutral-900"}`}>
                              <DropdownMenuItem 
                                onClick={() => handleOpenRename(slate._id, slate.title)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleToggleShare(slate._id)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                {slate.isShared ? "Unshare" : "Share"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className={`${theme === "dark" ? "bg-neutral-800" : "bg-neutral-100"}`} />
                              <DropdownMenuItem 
                                onClick={() => handleDeleteSlate(slate._id)}
                                variant="destructive"
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>

                      <CardFooter className="p-4 pt-2 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(slate.lastEdited).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}
                        </span>
                        
                        {slate.isShared && (
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[9px] font-bold">
                            <Globe className="w-2.5 h-2.5" />
                            Shared
                          </span>
                        )}
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: RECENT SLATES */}
          {activeTab === "recent" && (
            <div className="space-y-6">
              <div className={`flex items-center justify-between border-b pb-3.5 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  <Clock className="w-5 h-5 text-purple-500" />
                  Recently Edited
                </h2>
              </div>

              {!slates ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                  <p className="text-sm font-semibold text-neutral-400">Loading your canvases...</p>
                </div>
              ) : recentSlates.length === 0 ? (
                <div className={`flex flex-col items-center justify-center py-20 text-center rounded-3xl border border-dashed p-8 ${
                  theme === "dark" ? "border-neutral-800 bg-neutral-950/20" : "border-neutral-300 bg-neutral-50/50"
                }`}>
                  <Clock className="w-12 h-12 text-neutral-600 mb-4" />
                  <h3 className="text-lg font-bold mb-2">No recent slates</h3>
                  <p className="text-neutral-500 text-sm max-w-sm mb-4">
                    Canvases you edit recently will show up here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {recentSlates.map((slate) => (
                    <Card 
                      key={slate._id} 
                      className={`group overflow-hidden rounded-2xl border transition-all duration-300 hover:shadow-xl relative flex flex-col justify-between ${
                        theme === "dark" 
                          ? "border-neutral-900 bg-neutral-950/40 hover:border-neutral-800" 
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      <div className={`h-36 relative flex items-center justify-center transition-opacity duration-300 border-b ${
                        theme === "dark" 
                          ? "bg-neutral-900/50 border-neutral-900 group-hover:bg-neutral-900/70" 
                          : "bg-neutral-100 border-neutral-200 group-hover:bg-neutral-100/70"
                      }`}>
                        <span className="text-4xl filter drop-shadow-md select-none">{slate.thumbnailIcon}</span>
                        <div className="absolute inset-0 bg-neutral-950/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                          <Button className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shadow-md cursor-pointer">
                            Open Canvas
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-start justify-between gap-1.5">
                          <CardTitle className="text-sm font-bold truncate leading-tight group-hover:text-purple-400 transition-colors">
                            {slate.title}
                          </CardTitle>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" className="text-neutral-500 hover:text-white cursor-pointer">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className={`${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-white border-neutral-200 text-neutral-900"}`}>
                              <DropdownMenuItem onClick={() => handleOpenRename(slate._id, slate.title)} className="flex items-center gap-2 cursor-pointer">
                                <Edit2 className="w-3.5 h-3.5" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleShare(slate._id)} className="flex items-center gap-2 cursor-pointer">
                                <Share2 className="w-3.5 h-3.5" />
                                {slate.isShared ? "Unshare" : "Share"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className={`${theme === "dark" ? "bg-neutral-800" : "bg-neutral-100"}`} />
                              <DropdownMenuItem onClick={() => handleDeleteSlate(slate._id)} variant="destructive" className="flex items-center gap-2 cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>

                      <CardFooter className="p-4 pt-2 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(slate.lastEdited).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}
                        </span>
                        
                        {slate.isShared && (
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[9px] font-bold">
                            <Globe className="w-2.5 h-2.5" />
                            Shared
                          </span>
                        )}
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SHARED SLATES */}
          {activeTab === "shared" && (
            <div className="space-y-6">
              <div className={`flex items-center justify-between border-b pb-3.5 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-500" />
                  Shared Canvases
                </h2>
              </div>

              {!slates ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                  <p className="text-sm font-semibold text-neutral-400">Loading your canvases...</p>
                </div>
              ) : sharedSlates.length === 0 ? (
                <div className={`flex flex-col items-center justify-center py-20 text-center rounded-3xl border border-dashed p-8 ${
                  theme === "dark" ? "border-neutral-800 bg-neutral-950/20" : "border-neutral-300 bg-neutral-50/50"
                }`}>
                  <Users className="w-12 h-12 text-neutral-600 mb-4" />
                  <h3 className="text-lg font-bold mb-2">No shared canvases</h3>
                  <p className="text-neutral-500 text-sm max-w-sm mb-4">
                    Any slate you select "Share" from the card options menu will display here, simulating team workspaces.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {sharedSlates.map((slate) => (
                    <Card 
                      key={slate._id} 
                      className={`group overflow-hidden rounded-2xl border transition-all duration-300 hover:shadow-xl relative flex flex-col justify-between ${
                        theme === "dark" 
                          ? "border-neutral-900 bg-neutral-950/40 hover:border-neutral-800" 
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      <div className={`h-36 relative flex items-center justify-center transition-opacity duration-300 border-b ${
                        theme === "dark" 
                          ? "bg-neutral-900/50 border-neutral-900 group-hover:bg-neutral-900/70" 
                          : "bg-neutral-100 border-neutral-200 group-hover:bg-neutral-100/70"
                      }`}>
                        <span className="text-4xl filter drop-shadow-md select-none">{slate.thumbnailIcon}</span>
                        <div className="absolute inset-0 bg-neutral-950/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                          <Button className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shadow-md cursor-pointer">
                            Open Canvas
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      <CardHeader className="p-4 pb-2">
                        <div className="flex items-start justify-between gap-1.5">
                          <CardTitle className="text-sm font-bold truncate leading-tight group-hover:text-purple-400 transition-colors">
                            {slate.title}
                          </CardTitle>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" className="text-neutral-500 hover:text-white cursor-pointer">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className={`${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-white border-neutral-200 text-neutral-900"}`}>
                              <DropdownMenuItem onClick={() => handleOpenRename(slate._id, slate.title)} className="flex items-center gap-2 cursor-pointer">
                                <Edit2 className="w-3.5 h-3.5" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleShare(slate._id)} className="flex items-center gap-2 cursor-pointer">
                                <Share2 className="w-3.5 h-3.5" />
                                Unshare
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className={`${theme === "dark" ? "bg-neutral-800" : "bg-neutral-100"}`} />
                              <DropdownMenuItem onClick={() => handleDeleteSlate(slate._id)} variant="destructive" className="flex items-center gap-2 cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>

                      <CardFooter className="p-4 pt-2 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(slate.lastEdited).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}
                        </span>
                        
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[9px] font-bold">
                          <Globe className="w-2.5 h-2.5" />
                          Shared
                        </span>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SETTINGS PAGE */}
          {activeTab === "settings" && (
            <div className="space-y-6">
              <div className={`flex items-center justify-between border-b pb-3.5 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
                <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                  <Settings className="w-5 h-5 text-purple-500" />
                  Dashboard Settings
                </h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Simulated Profile Card */}
                <Card className={`lg:col-span-2 rounded-2xl border ${theme === "dark" ? "border-neutral-900 bg-neutral-950/40" : "border-neutral-200 bg-white"}`}>
                  <CardHeader>
                    <CardTitle className="text-md font-bold">User Information</CardTitle>
                    <CardDescription className="text-neutral-500">Customize how your details look on the Slate canvas.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Display Name</label>
                      <Input 
                        placeholder="Display Name" 
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className={`rounded-xl ${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-neutral-50 border-neutral-200 text-neutral-900"}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Email Address</label>
                      <Input 
                        value={emailAddress}
                        className={`rounded-xl cursor-not-allowed opacity-60 ${theme === "dark" ? "bg-neutral-900 border-neutral-800 text-white" : "bg-neutral-50 border-neutral-200 text-neutral-900"}`}
                        disabled
                      />
                    </div>
                  </CardContent>
                  <CardFooter className={`flex justify-end gap-2 border-t pt-4 ${theme === "dark" ? "border-neutral-900" : "border-neutral-200"}`}>
                    <Button 
                      onClick={() => alert("Profile updated (Simulated)")}
                      className="rounded-xl bg-purple-600 text-white hover:bg-purple-700 font-bold px-5 cursor-pointer"
                    >
                      Save Changes
                    </Button>
                  </CardFooter>
                </Card>

                {/* Theme & Details */}
                <div className="space-y-6">
                  {/* Preferences card */}
                  <Card className={`rounded-2xl border ${theme === "dark" ? "border-neutral-900 bg-neutral-950/40" : "border-neutral-200 bg-white"}`}>
                    <CardHeader>
                      <CardTitle className="text-md font-bold">Preferences</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Dashboard Theme</span>
                        <div className={`flex rounded-xl p-1 border ${theme === "dark" ? "bg-neutral-900 border-neutral-800" : "bg-neutral-100 border-neutral-200"}`}>
                          <button
                            onClick={() => setTheme("light")}
                            className={`p-2 rounded-lg flex items-center justify-center cursor-pointer ${
                              theme === "light" 
                                ? "bg-white text-purple-600 shadow-md" 
                                : "text-neutral-400 hover:text-white"
                            }`}
                          >
                            <Sun className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setTheme("dark")}
                            className={`p-2 rounded-lg flex items-center justify-center cursor-pointer ${
                              theme === "dark" 
                                ? "bg-neutral-950 text-purple-400 shadow-md" 
                                : "text-neutral-500 hover:text-neutral-900"
                            }`}
                          >
                            <Moon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Security Alert Card */}
                  <Card className={`rounded-2xl border ${theme === "dark" ? "border-neutral-900 bg-neutral-950/40" : "border-neutral-200 bg-white"}`}>
                    <CardHeader>
                      <CardTitle className="text-md font-bold flex items-center gap-2 text-amber-500">
                        <ShieldAlert className="w-5 h-5" />
                        Developer Info
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-neutral-500 space-y-2 leading-relaxed">
                      <p>
                        Your Slate backend runs securely inside Convex Cloud functions with automated Clerk JWT token checks.
                      </p>
                      <p className="font-semibold text-purple-500">
                        Deployment ID: precious-mosquito-802
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
