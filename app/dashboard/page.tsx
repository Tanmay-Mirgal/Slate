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
  const userPlanInfo = useQuery(api.slates.getUserPlan);
  const createSlate = useMutation(api.slates.create);
  const removeSlate = useMutation(api.slates.remove);
  const renameSlate = useMutation(api.slates.rename);
  const upgradePlanMutation = useMutation(api.slates.upgradePlan);

  // VIP Owner Check
  const userEmail = (user?.primaryEmailAddress?.emailAddress || "").toLowerCase();
  const isVipUser = userEmail === "tanmaymirgal26@gmail.com";

  // Auto-upgrade VIP user to MAX plan in Convex database
  React.useEffect(() => {
    if (isVipUser && userPlanInfo && userPlanInfo.plan !== "MAX") {
      upgradePlanMutation({ plan: "MAX", paymentId: "vip_owner_max_access" }).catch(console.error);
    }
  }, [isVipUser, userPlanInfo, upgradePlanMutation]);

  const effectivePlanInfo = isVipUser
    ? { plan: "MAX", maxSlates: 9999, storageMb: 102400, isPro: true, isMax: true, isVip: true }
    : userPlanInfo;
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


  // Helper to pick a random illustration 1-5 that isn't the same as the last one
  const getRandomIcon = () => {
    const lastIcon = slates?.[0]?.thumbnailIcon || "1";
    let next = Math.floor(Math.random() * 5) + 1;
    while (next.toString() === lastIcon) {
      next = Math.floor(Math.random() * 5) + 1;
    }
    return next.toString();
  };

  // Handle New Slate Creation (with Plan Limit Check)

  const handleCreateSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    if (userPlanInfo?.plan === "FREE" && (slates?.length || 0) >= 3) {
      alert("⚠️ Starter Plan Limit Reached (3/3 Slates)!\n\nPlease upgrade to PRO or MAX with Razorpay for unlimited slates.");
      setIsCreateOpen(false);
      setActiveTab("settings");
      return;
    }

    setIsCreating(true);
    try {
      const id = await createSlate({
        title: newTitle.trim(),
        thumbnailIcon: getRandomIcon(),
      });
      setIsCreateOpen(false);
      setNewTitle("");
      router.push(`/canvas/${id}`);
    } catch (error: any) {
      if (error?.message?.includes("FREE_LIMIT_REACHED")) {
        alert("⚠️ Starter Plan Limit Reached (3/3 Slates)!\n\nPlease upgrade to PRO or MAX via Razorpay for unlimited slates.");
        setIsCreateOpen(false);
        setActiveTab("settings");
      } else {
        console.error("Failed to create slate:", error);
      }
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

  // Handle Razorpay Payment
  const handleRazorpayPayment = async (planName: string, amountInINR: number) => {
    const res = await new Promise<boolean>((resolve) => {
      if ((window as any).Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

    if (!res) {
      alert("Razorpay SDK failed to load. Please check your internet connection.");
      return;
    }

    const options = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_slateWorkspace123",
      amount: amountInINR * 100,
      currency: "INR",
      name: "SLATE",
      description: `Upgrade to SLATE ${planName} Plan`,
      image: typeof window !== "undefined" ? `${window.location.origin}/logo.svg` : "/logo.svg",
      handler: async function (response: any) {
        try {
          await upgradePlanMutation({
            plan: planName,
            paymentId: response.razorpay_payment_id || "pay_razorpay_success",
          });
          alert(`🎉 Payment Successful!\nPayment ID: ${response.razorpay_payment_id}\nYour account is now upgraded to ${planName} Plan!`);
        } catch (e) {
          console.error("Failed persisting upgrade", e);
        }
      },
      prefill: {
        name: user?.fullName || "Developer",
        email: user?.primaryEmailAddress?.emailAddress || "dev@slate.app",
      },
      theme: {
        color: "#ffffff",
      },
    };

    const paymentObject = new (window as any).Razorpay(options);
    paymentObject.open();
  };

  // Filter slates based on searchQuery & activeTab
  const filteredSlates = (slates || []).filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeTab === "shared") return matchesSearch && s.isShared;
    return matchesSearch;
  });

  const handleCreateNewSlateFromCommand = async (isAi = false) => {
    try {
      const id = await createSlate({
        title: isAi ? "AI Architecture Slate" : "Untitled Slate",
        thumbnailIcon: getRandomIcon(),
      });
      router.push(`/canvas/${id}${isAi ? "?ai=true" : ""}`);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#0A0A0A] text-black font-sans selection:bg-[#ffffff]/30 select-none overflow-hidden">
      
      {/* Raycast Command Palette Modal */}
      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => handleCreateNewSlateFromCommand(false)}
        onGoDashboard={() => setActiveTab("recent")}
        onAiGenerate={() => handleCreateNewSlateFromCommand(true)}
      />

      {/* LEFT SIDEBAR (#101010) */}
      <aside className="w-64 h-full border-r border-[#2B2B2B] bg-[#101010] flex flex-col justify-between shrink-0 p-4">
        
        <div className="space-y-6">
          {/* Workspace Switcher Header */}
          <div className="flex items-center justify-between px-2">
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/logo.svg"
                alt="Slate Logo"
                width={26}
                height={26}
                className="rounded-lg shadow-sm"
              />
              <div>
                <h2 className="font-bold text-xs tracking-tight text-white leading-tight">
                  {user?.fullName ? `${user.fullName}'s Slate` : "Slate Workspace"}
                </h2>
                <p className="text-[10px] text-[#808080]">
                  {effectivePlanInfo?.isMax
                    ? "MAX Plan — Unlimited Access"
                    : effectivePlanInfo?.isPro
                    ? "Pro Plan — 10 GB Storage"
                    : "Free Plan — 3 Slates Limit"}
                </p>
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
              <span className="text-[#808080] font-mono">
                {effectivePlanInfo?.isMax
                  ? "1.2 GB / 100 GB"
                  : effectivePlanInfo?.isPro
                  ? "1.2 GB / 10 GB"
                  : "12 MB / 100 MB"}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#1A1A1A] overflow-hidden">
              <div className="h-full bg-[#ffffff] rounded-full w-12" />
            </div>
          </div>
        </div>

        {/* User Account Bar */}
        <div className="pt-4 border-t border-[#2B2B2B] flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <UserButton />
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
                className="pl-9 pr-4 py-1.5 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs text-white placeholder-[#666666] outline-none w-56 focus:border-[#ffffff] transition-colors font-sans"
              />
            </div>

            {/* CREATE NEW SLATE DIALOG MODAL */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <FolderPlus className="w-5 h-5 text-[#ffffff]" />
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
                      className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white placeholder-[#666666] outline-none focus:border-[#ffffff] transition-colors font-sans"
                    />
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
                      className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-10 px-5 cursor-pointer"
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
              className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-10 px-4 flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Board
            </Button>
          </div>

          {/* SLATES GRID OR SETTINGS BILLING SECTION */}
          {activeTab === "settings" ? (
            <div className="space-y-6">
              <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#ffffff]" />
                  Subscription Plans & Razorpay Billing
                </h3>
                <p className="text-xs text-[#808080]">
                  Manage your subscription tier and upgrade instantly via Razorpay payment gateway.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 text-left">
                  {/* PLAN 1: FREE */}
                  <div className="p-5 rounded-xl border border-[#2B2B2B] bg-[#101010] space-y-4 flex flex-col justify-between">
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">FREE Starter</span>
                      <div className="text-xl font-bold text-white">₹0 <span className="text-xs text-[#808080]">/ month</span></div>
                      <div className="space-y-1.5 pt-2 text-xs text-[#C5C5C5]">
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> Max 3 Active Slates</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> Basic Canvas Tools</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> 100 MB Cloud Storage</div>
                      </div>
                    </div>
                    <Button disabled variant="outline" className="w-full rounded-xl border-[#2B2B2B] bg-[#141414] text-[#808080] text-xs h-9">
                      Current Active Plan
                    </Button>
                  </div>

                  {/* PLAN 2: PRO */}
                  <div className="p-5 rounded-xl border-2 border-[#ffffff] bg-[#101010] space-y-4 flex flex-col justify-between shadow-lg relative">
                    <div className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full bg-[#ffffff] text-black text-[9px] font-bold uppercase">Popular</div>
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">PRO Team</span>
                      <div className="text-xl font-bold text-white">₹499 <span className="text-xs text-[#808080]">/ month</span></div>
                      <div className="space-y-1.5 pt-2 text-xs text-[#C5C5C5]">
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#ffffff]" /> Unlimited Slates</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#ffffff]" /> Notion Markdown Editor</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#ffffff]" /> Realtime Presence Cursors</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#ffffff]" /> Raycast Command Palette</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#ffffff]" /> 10 GB Cloud Storage</div>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleRazorpayPayment("PRO", 499)}
                      className="w-full rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-9 cursor-pointer"
                    >
                      Pay with Razorpay (₹499)
                    </Button>
                  </div>

                  {/* PLAN 3: MAX */}
                  <div className="p-5 rounded-xl border border-[#2B2B2B] bg-[#101010] space-y-4 flex flex-col justify-between">
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">MAX Unlimited</span>
                      <div className="text-xl font-bold text-white">₹1,499 <span className="text-xs text-[#808080]">/ month</span></div>
                      <div className="space-y-1.5 pt-2 text-xs text-[#C5C5C5]">
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> Everything in PRO</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> Unlimited Slate AI Assistant</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> SAML SSO & Priority SLA</div>
                        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-400" /> 100 GB Cloud Storage</div>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleRazorpayPayment("MAX", 1499)}
                      className="w-full rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] text-white text-xs font-semibold h-9 cursor-pointer"
                    >
                      Pay with Razorpay (₹1,499)
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
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
                <div className="p-4 rounded-2xl bg-[#1A1A1A] text-[#ffffff] w-fit mx-auto">
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
                  className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-10 px-4 cursor-pointer"
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
                    {/* Top Thumbnail Canvas Preview - Random Illustration */}
                    <Link href={`/canvas/${slate._id}`} className="h-52 border-b border-[#2B2B2B] flex items-center justify-center relative overflow-hidden bg-white group-hover:brightness-95 transition-all">
                      <Image
                        src={['1','2','3','4','5','6','7','8','9','10'].includes(slate.thumbnailIcon) ? `/illustration_${slate.thumbnailIcon}.svg` : `/illustration_${(slate._id.charCodeAt(0) % 10) + 1}.svg`}
                        alt="Slate Illustration"
                        fill
                        className="object-cover opacity-90 group-hover:scale-105 transition-transform duration-500"
                      />
                      
                      {slate.isShared && (
                        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/80 border border-white/20 text-white text-[10px] font-bold tracking-wide">
                          Shared
                        </div>
                      )}
                    </Link>

                    {/* Bottom Metadata Bar */}
                    <div className="p-4 flex items-center justify-between">
                      <Link href={`/canvas/${slate._id}`} className="space-y-0.5 overflow-hidden pr-2">
                        <h4 className="text-xs font-bold text-white truncate group-hover:text-[#ffffff] transition-colors">
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
          )}
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
                className="w-full h-11 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3.5 text-xs text-white outline-none focus:border-[#ffffff] font-sans"
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
                  className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-10 px-4 cursor-pointer"
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
