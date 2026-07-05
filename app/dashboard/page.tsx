import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
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
  UserCheck
} from "lucide-react";

export default async function DashboardPage() {
  // Fetch Clerk user details in the Server Component
  const user = await currentUser();
  const firstName = user?.firstName || "Creator";
  const emailAddress = user?.emailAddresses?.[0]?.emailAddress || "creator@slate.com";

  // Mock Slates Data
  const mockSlates = [
    {
      id: "slate-1",
      title: "Homepage Redesign Mockup",
      lastEdited: "10 mins ago",
      collaborators: 3,
      previewBg: "bg-gradient-to-tr from-purple-500/20 to-indigo-500/10",
      thumbnailIcon: "📐"
    },
    {
      id: "slate-2",
      title: "Team Brainstorming Session",
      lastEdited: "2 hours ago",
      collaborators: 5,
      previewBg: "bg-gradient-to-tr from-emerald-500/20 to-teal-500/10",
      thumbnailIcon: "💡"
    },
    {
      id: "slate-3",
      title: "Slate Database Schema Flow",
      lastEdited: "Yesterday",
      collaborators: 1,
      previewBg: "bg-gradient-to-tr from-amber-500/20 to-orange-500/10",
      thumbnailIcon: "💾"
    },
    {
      id: "slate-4",
      title: "User Journey Map - V2",
      lastEdited: "3 days ago",
      collaborators: 2,
      previewBg: "bg-gradient-to-tr from-pink-500/20 to-rose-500/10",
      thumbnailIcon: "🗺️"
    }
  ];

  return (
    <div className="flex h-screen bg-[#070709] text-zinc-100 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-900 bg-black flex flex-col justify-between shrink-0">
        <div>
          {/* Sidebar Logo */}
          <div className="h-16 px-6 border-b border-zinc-900 flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={36}
              height={36}
              className="rounded-md shadow-[0_0_10px_rgba(147,51,234,0.1)]"
            />
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              Slate
            </span>
            <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-[9px] font-semibold text-purple-400 border border-purple-500/20">PRO</span>
          </div>

          {/* Navigation Links */}
          <div className="p-4 space-y-1">
            <Link 
              href="/dashboard" 
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium transition-colors"
            >
              <Layout className="w-4 h-4 text-purple-400" />
              <span>All Slates</span>
            </Link>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-950 text-sm font-medium transition-colors text-left">
              <Clock className="w-4 h-4" />
              <span>Recent</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-950 text-sm font-medium transition-colors text-left">
              <Users className="w-4 h-4" />
              <span>Shared with me</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-950 text-sm font-medium transition-colors text-left">
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* User Card */}
        <div className="p-4 border-t border-zinc-900 bg-zinc-950/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="ring-2 ring-purple-600/30 rounded-full">
                <UserButton />
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-white truncate">{firstName}</p>
                <p className="text-[10px] text-zinc-500 truncate">{emailAddress}</p>
              </div>
            </div>
            <Link href="/" className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition-colors">
              <LogOut className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        {/* Top Navbar */}
        <header className="h-16 px-8 border-b border-zinc-900 flex items-center justify-between bg-black/40 backdrop-blur-sm sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4 bg-zinc-950 border border-zinc-900 px-3 py-1.5 rounded-lg w-96">
            <Search className="w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search your slates..." 
              className="bg-transparent text-sm w-full outline-none text-zinc-200 placeholder-zinc-500"
            />
          </div>

          <div className="flex items-center gap-4">
            {/* Storage Meter */}
            <div className="hidden lg:flex items-center gap-3 text-xs text-zinc-400 border-r border-zinc-900 pr-4">
              <HardDrive className="w-4 h-4 text-zinc-500" />
              <div className="space-y-1">
                <div className="flex justify-between font-semibold">
                  <span>Storage Used</span>
                  <span>14%</span>
                </div>
                <div className="w-24 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="bg-purple-600 h-full w-[14%]" />
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-sm font-semibold text-white hover:opacity-90 shadow-md shadow-purple-600/10 active:scale-[0.98] transition-all">
              <Plus className="w-4 h-4" />
              New Slate
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 p-8 space-y-8 max-w-7xl w-full mx-auto">
          {/* Welcome Banner */}
          <div className="relative rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-500/10 via-indigo-500/5 to-transparent p-6 overflow-hidden">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[80px] pointer-events-none" />
            
            <div className="max-w-2xl">
              <h1 className="text-2xl md:text-3xl font-extrabold text-white mb-2 tracking-tight">
                Welcome back, {firstName}! ✨
              </h1>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Create infinite canvases, organize flowcharts, and share live slates with your teammates instantly.
              </p>
            </div>
            
            {/* Integration check banner */}
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 font-medium">
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Clerk Auth Connection: Successfully authenticated as {emailAddress}</span>
            </div>
          </div>

          {/* Quick Metrics / Stats Grid */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-xl border border-zinc-900 bg-zinc-950/40 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-zinc-500 text-xs font-semibold">Total Slates</span>
                <p className="text-2xl font-bold text-white">4 / ∞</p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
                <FileText className="w-5 h-5" />
              </div>
            </div>

            <div className="p-5 rounded-xl border border-zinc-900 bg-zinc-950/40 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-zinc-500 text-xs font-semibold">Active Collaborators</span>
                <p className="text-2xl font-bold text-white">8 Members</p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="p-5 rounded-xl border border-zinc-900 bg-zinc-950/40 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-zinc-500 text-xs font-semibold">Live Sync Status</span>
                <p className="text-2xl font-bold text-emerald-400 flex items-center gap-1.5">
                  <Activity className="w-5 h-5 text-emerald-400 animate-pulse" />
                  Active
                </p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </section>

          {/* Slates Header */}
          <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
            <h2 className="text-lg font-bold text-white tracking-tight">Your Recent Slates</h2>
            
            <div className="flex items-center gap-2">
              <button className="p-1.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800 hover:text-white transition-colors">
                <Grid className="w-4 h-4" />
              </button>
              <button className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors">
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Slates Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {mockSlates.map((slate) => (
              <div 
                key={slate.id} 
                className="group rounded-xl border border-zinc-900 bg-black hover:border-zinc-800 transition-all duration-300 hover:shadow-2xl flex flex-col justify-between overflow-hidden"
              >
                {/* Slate Card Preview Thumbnail */}
                <div className={`h-36 ${slate.previewBg} relative flex items-center justify-center border-b border-zinc-900 transition-opacity duration-300 group-hover:opacity-90`}>
                  <span className="text-4xl filter drop-shadow-md">{slate.thumbnailIcon}</span>
                  
                  {/* Subtle hover overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                    <button className="px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition-colors flex items-center gap-1.5 shadow-md">
                      Open Canvas
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Slate Card Footer Details */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-200 group-hover:text-white truncate pr-2">
                      {slate.title}
                    </h3>
                    <button className="text-zinc-600 hover:text-zinc-300 shrink-0">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 font-medium">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {slate.lastEdited}
                    </span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      <Users className="w-3 h-3" />
                      {slate.collaborators} {slate.collaborators > 1 ? "collaborators" : "only you"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
