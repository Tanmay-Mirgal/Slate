"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useUser
} from "@clerk/nextjs";

import {
  ArrowRight,
  Sparkles,
  Zap,
  Users,
  Layout,
  FileText,
  Command,
  Database,
  Check,
  MousePointer,
  ChevronRight,
  Share2,
  Search
} from "lucide-react";

import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";

export default function LandingPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, user } = useUser();
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const createSlateMutation = useMutation(api.slates.create);

  const handleCreateNewSlate = async (isAi = false) => {
    if (!isSignedIn) {
      router.push("/auth?mode=sign-in");
      return;
    }
    try {
      const id = await createSlateMutation({
        title: isAi ? "AI Architecture Slate" : "Untitled Slate",
        thumbnailIcon: isAi ? "Cpu" : "Database",
      });
      router.push(`/canvas/${id}${isAi ? "?ai=true" : ""}`);
    } catch (e) {
      console.error(e);
      router.push("/dashboard");
    }
  };

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
      image: typeof window !== "undefined" ? `${window.location.origin}/logo.png` : "/logo.png",
      handler: function (response: any) {
        alert(`🎉 Payment Successful!\nPayment ID: ${response.razorpay_payment_id}\nYour account is upgraded to ${planName} Plan!`);
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

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-black font-sans selection:bg-[#ffffff]/30 select-none">
      
      {/* Global Raycast Command Palette */}
      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => handleCreateNewSlate(false)}
        onGoDashboard={() => router.push(isSignedIn ? "/dashboard" : "/auth?mode=sign-in")}
        onAiGenerate={() => handleCreateNewSlate(true)}
      />

      {/* SLEEK SAAS NAVIGATION HEADER (WIDE SEARCH & BALANCED SPACING) */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-[#2B2B2B] bg-[#0A0A0A]/95 backdrop-blur-md px-8 flex items-center justify-between">
        
        {/* Left: Brand Logo & Navigation Links */}
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={26}
              height={26}
              className="rounded-lg shadow-sm group-hover:scale-105 transition-transform"
            />
            <span className="font-bold text-base tracking-tight text-white">
              SLATE
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-8 text-xs font-semibold text-[#C5C5C5]">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#features" className="hover:text-white transition-colors">Documentation</a>
            <a href="#pricing" className="hover:text-white transition-colors">Enterprise</a>
          </nav>
        </div>

        {/* Center: Extra Wide Search Bar Button (Eliminates Emptiness) */}
        <button
          onClick={() => setIsCommandOpen(true)}
          className="hidden sm:flex items-center justify-between w-72 md:w-96 px-4 py-2 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#808080] hover:text-white hover:border-[#333333] transition-all cursor-pointer shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <Search className="w-4 h-4 text-[#808080]" />
            <span className="text-xs text-[#808080] truncate">Search slates, architecture or commands...</span>
          </div>
          <kbd className="px-1.5 py-0.5 rounded border border-[#2B2B2B] bg-[#1A1A1A] text-[10px] font-mono text-[#C5C5C5]">
            Ctrl K
          </kbd>
        </button>

        {/* Right: Auth Action Buttons (Guaranteed Rendering when Logged Out) */}
        <div className="flex items-center gap-3">
          {(!isLoaded || !isSignedIn) ? (
            <>
              <Link href="/auth?mode=sign-in">
                <Button size="sm" className="rounded-xl bg-transparent border border-[#3A3A3A] hover:border-[#ffffff] hover:bg-[#ffffff]/10 text-[#C5C5C5] hover:text-black font-semibold text-xs h-9 px-4 cursor-pointer transition-all">
                  Log In
                </Button>
              </Link>
              <Link href="/auth?mode=sign-up">
                <Button size="sm" className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black font-semibold text-xs h-9 px-4 cursor-pointer shadow-sm">
                  Sign Up
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/dashboard">
                <Button size="sm" className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black font-semibold text-xs h-9 px-4 cursor-pointer flex items-center gap-1.5 shadow-sm">
                  Go to Dashboard
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
              <UserButton afterSignOutUrl="/">
                <UserButton.MenuItems>
                  <UserButton.Link label="Dashboard" labelIcon={<Layout className="w-4 h-4 text-[#ffffff]" />} href="/dashboard" />
                </UserButton.MenuItems>
              </UserButton>
            </>
          )}
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="pt-36 pb-16 px-6 max-w-5xl mx-auto text-center flex flex-col items-center">
        
        {/* Simple Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#C5C5C5] mb-6">
          <Sparkles className="w-3.5 h-3.5 text-[#ffffff]" />
          <span>The Visual Workspace for Modern Teams</span>
        </div>

        {/* Clean Hero Headline */}
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.08] max-w-3xl mb-6">
          Think. Draw. Collaborate.
        </h1>

        {/* Supporting Subheadline */}
        <p className="text-base md:text-lg text-[#C5C5C5] max-w-xl leading-relaxed font-normal mb-8">
          Slate combines infinite whiteboard diagramming with real-time markdown documentation and AI system architecture tools.
        </p>

        {/* CTA Buttons */}
        <div className="flex items-center gap-3 mb-16">
          {(!isLoaded || !isSignedIn) ? (
            <Link href="/auth?mode=sign-up">
              <Button className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black font-semibold text-sm h-11 px-6 transition-all cursor-pointer flex items-center gap-2 shadow-md">
                Start Free Workspace
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          ) : (
            <Link href="/dashboard">
              <Button className="rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black font-semibold text-sm h-11 px-6 transition-all cursor-pointer flex items-center gap-2">
                Open Dashboard
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          )}

          <Link href="/dashboard">
            <Button variant="outline" className="rounded-xl border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] text-[#C5C5C5] hover:text-white font-semibold text-sm h-11 px-5 cursor-pointer">
              Explore Demo
            </Button>
          </Link>
        </div>

        {/* CLEAN PRODUCT UI PREVIEW SHOWCASE */}
        <div className="w-full rounded-2xl border border-[#2B2B2B] bg-[#101010] p-2.5 shadow-2xl text-left">
          <div className="h-9 border-b border-[#2B2B2B] bg-[#141414] px-4 flex items-center justify-between rounded-t-xl">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#2B2B2B]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#2B2B2B]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#2B2B2B]" />
              <span className="ml-2 text-xs font-mono text-[#808080]">slate.app/canvas</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#808080]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Realtime Connected</span>
            </div>
          </div>

          <div className="h-80 bg-[#0D0D0D] p-6 relative flex items-center justify-center overflow-hidden rounded-b-xl">
            {/* Background Dot Grid */}
            <div className="absolute inset-0 bg-[radial-gradient(#1B1B1B_1px,transparent_1px)] [background-size:20px_20px] opacity-80" />

            {/* Architecture Diagrams Showcase */}
            <div className="relative z-10 flex items-center gap-8">
              <div className="w-48 p-4 rounded-xl border border-[#ffffff] bg-[#141414] shadow-xl space-y-2">
                <div className="w-full h-1 bg-[#ffffff] rounded-full" />
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-[#ffffff]" />
                  PostgreSQL Database
                </div>
                <div className="text-[10px] text-[#808080]">Primary Storage Cluster</div>
              </div>

              <div className="text-[#808080] font-mono text-xs">───▶</div>

              <div className="w-48 p-4 rounded-xl border border-[#2B2B2B] bg-[#141414] shadow-xl space-y-2">
                <div className="w-full h-1 bg-emerald-500 rounded-full" />
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  API Microservice
                </div>
                <div className="text-[10px] text-[#808080]">Convex Cloud Handlers</div>
              </div>
            </div>

            {/* Live Cursor */}
            <div className="absolute top-20 right-36 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ffffff] text-black text-xs font-bold shadow-xl">
              <MousePointer className="w-3.5 h-3.5" />
              <span>Teammate</span>
            </div>
          </div>
        </div>

      </section>

      {/* CORE FEATURES */}
      <section id="features" className="py-20 px-6 max-w-5xl mx-auto border-t border-[#2B2B2B]">
        <div className="text-center max-w-xl mx-auto mb-12">
          <h2 className="text-2xl font-bold tracking-tight text-white mb-3">
            Everything for Modern Architecture Design
          </h2>
          <p className="text-[#808080] text-xs">
            Built for speed and clarity with zero clutter.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          
          <div className="p-5 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-3">
            <div className="p-2.5 rounded-xl bg-[#1A1A1A] w-fit text-[#ffffff]">
              <Layout className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Infinite Whiteboard</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Vector diagramming engine with connectors, shapes, sticky notes, and system nodes.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-3">
            <div className="p-2.5 rounded-xl bg-[#1A1A1A] w-fit text-[#ffffff]">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Markdown Documentation</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Split-screen markdown editor side-by-side with your architectural whiteboards.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-3">
            <div className="p-2.5 rounded-xl bg-[#1A1A1A] w-fit text-[#ffffff]">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Realtime Presence</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Sub-second multiplayer cursor drifting and live drawing stroke synchronization.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-3">
            <div className="p-2.5 rounded-xl bg-[#1A1A1A] w-fit text-[#ffffff]">
              <Command className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Raycast Command Palette</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Press Ctrl + K anywhere for instant search, actions, and workspace navigation.
            </p>
          </div>

        </div>
      </section>

      {/* RAZORPAY BILLING & 3 SUBSCRIPTION PLANS SECTION */}
      <section id="pricing" className="py-20 px-6 border-t border-[#2B2B2B] bg-[#101010]/40">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white mb-3">
            Simple, Transparent Pricing
          </h2>
          <p className="text-[#808080] text-xs max-w-md mx-auto mb-12">
            Instant billing via Razorpay — Choose the plan that fits your team.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            
            {/* PLAN 1: FREE (Starter) */}
            <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-5 flex flex-col justify-between">
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-white">FREE (Starter)</h3>
                <div className="text-2xl font-bold text-white">₹0 <span className="text-xs text-[#808080] font-normal">/ forever</span></div>
                <p className="text-xs text-[#808080]">Limited starter plan for individuals.</p>
                <div className="space-y-2 pt-3 border-t border-[#2B2B2B] text-xs text-[#C5C5C5]">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Max 3 Active Slates</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Basic Canvas Diagramming</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 100 MB Cloud Storage</div>
                </div>
              </div>
              <SignInButton mode="modal">
                <Button variant="outline" className="w-full rounded-xl border-[#2B2B2B] bg-[#1A1A1A] hover:bg-[#202020] text-white text-xs font-semibold h-10 cursor-pointer">
                  Current Free Plan
                </Button>
              </SignInButton>
            </div>

            {/* PLAN 2: PRO (₹499) */}
            <div className="p-6 rounded-2xl border-2 border-[#ffffff] bg-[#141414] space-y-5 relative shadow-2xl flex flex-col justify-between">
              <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-[#ffffff] text-black text-[10px] font-bold uppercase tracking-wider">
                Popular
              </div>
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-white">PRO</h3>
                <div className="text-2xl font-bold text-white">₹499 <span className="text-xs text-[#808080] font-normal">/ month ($9)</span></div>
                <p className="text-xs text-[#808080]">For professional engineering teams.</p>
                <div className="space-y-2 pt-3 border-t border-[#2B2B2B] text-xs text-[#C5C5C5]">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#ffffff]" /> Unlimited Infinite Slates</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#ffffff]" /> Notion Markdown Split Editor</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#ffffff]" /> Realtime Multiplayer Cursors</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#ffffff]" /> Raycast Command Palette</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#ffffff]" /> 10 GB Cloud Storage</div>
                </div>
              </div>
              <Button
                onClick={() => handleRazorpayPayment("PRO", 499)}
                className="w-full rounded-xl bg-[#ffffff] hover:bg-[#e5e5e5] text-black text-xs font-semibold h-10 cursor-pointer shadow-md"
              >
                Pay with Razorpay (₹499)
              </Button>
            </div>

            {/* PLAN 3: MAX (₹1,499) */}
            <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-5 flex flex-col justify-between">
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-white">MAX (Unlimited)</h3>
                <div className="text-2xl font-bold text-white">₹1,499 <span className="text-xs text-[#808080] font-normal">/ month ($29)</span></div>
                <p className="text-xs text-[#808080]">For enterprise organizations requiring AI & priority support.</p>
                <div className="space-y-2 pt-3 border-t border-[#2B2B2B] text-xs text-[#C5C5C5]">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Everything in PRO Plan</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Unlimited Slate AI Assistant</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Custom SAML SSO & Security</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 100 GB Dedicated Storage</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 24/7 Priority SLA Support</div>
                </div>
              </div>
              <Button
                onClick={() => handleRazorpayPayment("MAX", 1499)}
                className="w-full rounded-xl border border-[#2B2B2B] bg-[#1A1A1A] hover:bg-[#202020] text-white text-xs font-semibold h-10 cursor-pointer"
              >
                Pay with Razorpay (₹1,499)
              </Button>
            </div>

          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-8 border-t border-[#2B2B2B] bg-[#0A0A0A] px-6 text-xs text-[#808080]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Slate" width={18} height={18} className="rounded" />
            <span className="font-bold text-white">SLATE</span>
            <span>© 2026 Slate Inc.</span>
          </div>
          <div className="flex items-center gap-6 text-[#C5C5C5]">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
