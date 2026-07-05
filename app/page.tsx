"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
  Show
} from "@clerk/nextjs";

import {
  ArrowRight,
  Sparkles,
  Zap,
  Users,
  Layout,
  FileText,
  Command,
  ShieldCheck,
  Globe,
  Database,
  Check,
  Layers,
  MousePointer,
  HelpCircle,
  ChevronRight,
  Share2,
  Search
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";

export default function LandingPage() {
  const router = useRouter();
  const { isSignedIn, user } = useUser();
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#7C3AED]/30 select-none">
      
      {/* Global Raycast Command Palette */}
      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => router.push(isSignedIn ? "/dashboard" : "/sign-in")}
      />

      {/* MINIMAL LINEAR-STYLE TOP NAVIGATION */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-[#2B2B2B] bg-[#0A0A0A]/90 backdrop-blur-md px-6 flex items-center justify-between">
        
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={28}
              height={28}
              className="rounded-lg shadow-sm group-hover:scale-105 transition-transform"
            />
            <span className="font-bold text-base tracking-tight text-white">
              SLATE
            </span>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-[#C5C5C5]">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#demo" className="hover:text-white transition-colors">Interactive Demo</a>
            <a href="#templates" className="hover:text-white transition-colors">Templates</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </nav>
        </div>

        {/* Right Auth & Command Trigger */}
        <div className="flex items-center gap-3">
          
          {/* Raycast Trigger Button */}
          <button
            onClick={() => setIsCommandOpen(true)}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#808080] hover:text-white hover:border-[#333333] transition-all cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
            <kbd className="px-1.5 py-0.5 rounded border border-[#2B2B2B] bg-[#1A1A1A] text-[10px] font-mono text-[#C5C5C5]">
              Ctrl K
            </kbd>
          </button>

          <Show when={!isSignedIn}>
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm" className="text-xs font-semibold text-[#C5C5C5] hover:text-white cursor-pointer">
                Log In
              </Button>
            </SignInButton>
            <SignInButton mode="modal">
              <Button size="sm" className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-semibold text-xs h-10 px-4 shadow-sm transition-all cursor-pointer">
                Get Started
              </Button>
            </SignInButton>
          </Show>

          <Show when={isSignedIn}>
            <Link href="/dashboard">
              <Button size="sm" className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-semibold text-xs h-10 px-4 shadow-sm transition-all cursor-pointer flex items-center gap-1.5">
                Go to Dashboard
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <UserButton afterSignOutUrl="/" />
          </Show>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="pt-36 pb-20 px-6 max-w-6xl mx-auto text-center flex flex-col items-center">
        
        {/* Top Product Announcement Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#C5C5C5] mb-8 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-[#7C3AED]" />
          <span>Introducing Slate 2.0 — Infinite Canvas meets Notion Docs</span>
          <ChevronRight className="w-3.5 h-3.5 text-[#808080]" />
        </div>

        {/* Main Headline */}
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.08] max-w-4xl mb-6">
          Think. Draw. Collaborate.
        </h1>

        {/* Supporting Paragraph */}
        <p className="text-lg md:text-xl text-[#C5C5C5] max-w-2xl leading-relaxed font-normal mb-10">
          Slate is a premium collaborative infinite whiteboard platform with AI architecture diagramming, Notion-like documentation, real-time presence, and Raycast command workflows.
        </p>

        {/* Primary & Secondary Call to Actions */}
        <div className="flex items-center gap-4 mb-16">
          <Show when={!isSignedIn}>
            <SignInButton mode="modal">
              <Button className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-semibold text-sm h-12 px-6 shadow-md transition-all cursor-pointer flex items-center gap-2">
                Start Creating Free
                <ArrowRight className="w-4 h-4" />
              </Button>
            </SignInButton>
          </Show>

          <Show when={isSignedIn}>
            <Link href="/dashboard">
              <Button className="rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-semibold text-sm h-12 px-6 shadow-md transition-all cursor-pointer flex items-center gap-2">
                Open Dashboard
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </Show>

          <a href="#demo">
            <Button variant="outline" className="rounded-xl border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] text-[#C5C5C5] hover:text-white font-semibold text-sm h-12 px-6 transition-all cursor-pointer">
              Explore Live Demo
            </Button>
          </a>
        </div>

        {/* PRODUCT SCREENSHOT / INTERACTIVE PREVIEW SHOWCASE */}
        <div className="w-full rounded-2xl border border-[#2B2B2B] bg-[#101010] p-3 shadow-2xl overflow-hidden text-left relative">
          <div className="h-10 border-b border-[#2B2B2B] bg-[#141414] px-4 flex items-center justify-between rounded-t-xl">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#333333]" />
              <div className="w-3 h-3 rounded-full bg-[#333333]" />
              <div className="w-3 h-3 rounded-full bg-[#333333]" />
              <span className="ml-2 text-xs font-mono text-[#808080]">slate.app/canvas/system-architecture</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#808080]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>2 Teammates Live</span>
            </div>
          </div>

          {/* Screenshot Content Mockup */}
          <div className="h-96 bg-[#0D0D0D] p-6 relative flex items-center justify-center overflow-hidden">
            
            {/* Minimal Background Dot Grid */}
            <div className="absolute inset-0 bg-[radial-gradient(#1B1B1B_1px,transparent_1px)] [background-size:20px_20px] opacity-80" />

            {/* Architecture Node Cards */}
            <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
              <div className="w-48 p-4 rounded-xl border border-[#7C3AED] bg-[#141414] shadow-xl space-y-2">
                <div className="w-full h-1 bg-[#7C3AED] rounded-full" />
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-[#7C3AED]" />
                  PostgreSQL DB
                </div>
                <div className="text-[10px] text-[#808080]">Primary Relational Store</div>
              </div>

              <div className="text-[#808080] font-mono text-xs">───▶</div>

              <div className="w-48 p-4 rounded-xl border border-[#2B2B2B] bg-[#141414] shadow-xl space-y-2">
                <div className="w-full h-1 bg-emerald-500 rounded-full" />
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  API Gateway
                </div>
                <div className="text-[10px] text-[#808080]">Convex Cloud Functions</div>
              </div>
            </div>

            {/* Live Teammate Cursor Badge */}
            <div className="absolute top-24 right-32 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7C3AED] text-white text-xs font-bold shadow-xl animate-bounce">
              <MousePointer className="w-3.5 h-3.5" />
              <span>Sarah (Editing)</span>
            </div>
          </div>
        </div>

      </section>

      {/* TRUSTED BY LOGO STRIP */}
      <section className="py-12 border-y border-[#2B2B2B] bg-[#101010]/50 text-center">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#808080] mb-8">
            Powering modern engineering & design teams worldwide
          </p>
          <div className="flex flex-wrap items-center justify-center gap-10 md:gap-16 opacity-60 grayscale hover:grayscale-0 transition-all">
            <span className="font-bold text-lg tracking-wider font-mono text-[#C5C5C5]">LINEAR</span>
            <span className="font-bold text-lg tracking-wider font-mono text-[#C5C5C5]">VERCEL</span>
            <span className="font-bold text-lg tracking-wider font-mono text-[#C5C5C5]">NOTION</span>
            <span className="font-bold text-lg tracking-wider font-mono text-[#C5C5C5]">FIGMA</span>
            <span className="font-bold text-lg tracking-wider font-mono text-[#C5C5C5]">STRIPE</span>
            <span className="font-bold text-lg tracking-wider font-mono text-[#C5C5C5]">RAYCAST</span>
          </div>
        </div>
      </section>

      {/* LINEAR-STYLE BENTO FEATURE GRID */}
      <section id="features" className="py-24 px-6 max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4">
            Designed for Speed, Precision and Focus
          </h2>
          <p className="text-[#808080] text-sm">
            Everything you need to brainstorm, document system architecture, and collaborate in real-time without context switching.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Feature 1 */}
          <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4 hover:border-[#333333] transition-colors">
            <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit text-[#7C3AED]">
              <Layout className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Infinite Whiteboard Canvas</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Vector rendering engine supporting shapes, arrow connectors, freehand drawings, sticky notes, and system component nodes.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4 hover:border-[#333333] transition-colors">
            <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit text-[#7C3AED]">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Notion-Style Documentation</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Split-screen markdown editor for architectural specs, meeting notes, and technical documentation side-by-side with your diagrams.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4 hover:border-[#333333] transition-colors">
            <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit text-[#7C3AED]">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Realtime Multiplayer Presence</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Live cursor drifting and atomic stroke broadcasting over Convex WebSockets for sub-second team collaboration.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4 hover:border-[#333333] transition-colors">
            <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit text-[#7C3AED]">
              <Command className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Raycast Command Palette</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Press Ctrl + K anywhere to trigger instant search, run platform actions, navigate slates, and switch themes seamlessly.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4 hover:border-[#333333] transition-colors">
            <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit text-[#7C3AED]">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">AI Architecture Generator</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Slide open Slate AI to generate database flowcharts, microservice architecture diagrams, and summarize technical notes.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="p-6 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-4 hover:border-[#333333] transition-colors">
            <div className="p-3 rounded-xl bg-[#1A1A1A] w-fit text-[#7C3AED]">
              <Share2 className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-white">Granular Share Permissions</h3>
            <p className="text-xs text-[#808080] leading-relaxed">
              Generate separate Edit Access links for team members and Read-Only presentation links for stakeholders.
            </p>
          </div>

        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="pricing" className="py-24 px-6 border-t border-[#2B2B2B] bg-[#101010]/30">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-[#808080] text-sm max-w-xl mx-auto mb-16">
            Start for free with your team, upgrade as your system architecture grows.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            
            {/* Free Plan */}
            <div className="p-8 rounded-2xl border border-[#2B2B2B] bg-[#141414] flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white">Starter</h3>
                <div className="text-3xl font-bold text-white">$0 <span className="text-xs text-[#808080] font-normal">/ forever</span></div>
                <p className="text-xs text-[#808080]">Perfect for individual developers and small side projects.</p>
                <div className="space-y-2 pt-4 border-t border-[#2B2B2B] text-xs text-[#C5C5C5]">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Up to 5 Active Slates</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Realtime Collaboration</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Basic Architecture Nodes</div>
                </div>
              </div>
              <Button variant="outline" className="w-full rounded-xl border-[#2B2B2B] bg-[#1A1A1A] hover:bg-[#202020] text-white text-xs font-semibold h-11 cursor-pointer">
                Get Started Free
              </Button>
            </div>

            {/* Pro Plan */}
            <div className="p-8 rounded-2xl border-2 border-[#7C3AED] bg-[#141414] flex flex-col justify-between space-y-6 relative shadow-2xl">
              <div className="absolute -top-3.5 right-6 px-3 py-0.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold uppercase tracking-wider">
                Most Popular
              </div>
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white">Pro Team</h3>
                <div className="text-3xl font-bold text-white">$15 <span className="text-xs text-[#808080] font-normal">/ member / month</span></div>
                <p className="text-xs text-[#808080]">For growing engineering teams requiring advanced architecture tools.</p>
                <div className="space-y-2 pt-4 border-t border-[#2B2B2B] text-xs text-[#C5C5C5]">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#7C3AED]" /> Unlimited Infinite Slates</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#7C3AED]" /> Notion-style Split Documentation</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#7C3AED]" /> Full AI Architecture Assistant</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#7C3AED]" /> Raycast Command Palette</div>
                </div>
              </div>
              <Button className="w-full rounded-xl bg-[#7C3AED] hover:bg-[#8B5CF6] text-white text-xs font-semibold h-11 cursor-pointer">
                Start 14-Day Pro Trial
              </Button>
            </div>

            {/* Enterprise Plan */}
            <div className="p-8 rounded-2xl border border-[#2B2B2B] bg-[#141414] flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white">Enterprise</h3>
                <div className="text-3xl font-bold text-white">Custom</div>
                <p className="text-xs text-[#808080]">Dedicated security, custom SAML SSO, and SOC2 compliance.</p>
                <div className="space-y-2 pt-4 border-t border-[#2B2B2B] text-xs text-[#C5C5C5]">
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Single Sign-On (SAML/Okta)</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Dedicated Cloud Instance</div>
                  <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 24/7 SLA Priority Support</div>
                </div>
              </div>
              <Button variant="outline" className="w-full rounded-xl border-[#2B2B2B] bg-[#1A1A1A] hover:bg-[#202020] text-white text-xs font-semibold h-11 cursor-pointer">
                Contact Sales
              </Button>
            </div>

          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 border-t border-[#2B2B2B] bg-[#0A0A0A] px-6 text-xs text-[#808080]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Slate" width={20} height={20} className="rounded" />
            <span className="font-bold text-white">SLATE</span>
            <span>© 2026 Slate Inc. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6 text-[#C5C5C5]">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <a href="#faq" className="hover:text-white">Privacy</a>
            <a href="#faq" className="hover:text-white">Terms</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
