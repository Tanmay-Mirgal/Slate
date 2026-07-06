"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { SignIn, SignUp } from "@clerk/nextjs";
import { Sparkles, ArrowLeft, Zap, Layout, FileText } from "lucide-react";

function AuthContent() {
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "sign-up" ? "sign-up" : "sign-in";
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">(initialMode);

  React.useEffect(() => {
    const queryMode = searchParams.get("mode");
    if (queryMode === "sign-up") setMode("sign-up");
    else if (queryMode === "sign-in") setMode("sign-in");
  }, [searchParams]);

  // Clerk variables drive the card's CSS tokens at root level.
  // colorBackground sets the card color so dividerText bg matches naturally — no black box.
  const clerkAppearance = {
    variables: {
      colorBackground: "#1A1A1A",       // card bg — visibly lighter than #0D0D0D panel
      colorInputBackground: "#141414",
      colorInputText: "#ffffff",
      colorText: "#ffffff",
      colorTextSecondary: "#9A9A9A",
      colorPrimary: "#7C3AED",
      colorDanger: "#ef4444",
      colorNeutral: "#3A3A3A",
      borderRadius: "10px",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "13px",
      fontWeight: { normal: 400, medium: 500, bold: 600 },
    },
    elements: {
      cardBox: "shadow-2xl !rounded-2xl border border-[#2B2B2B] overflow-hidden",
      card: "!bg-[#1A1A1A] shadow-none",
      headerTitle: "!text-white font-bold",
      headerSubtitle: "!text-[#9A9A9A]",
      formButtonPrimary: "!bg-[#7C3AED] hover:!bg-[#8B5CF6] normal-case !text-white font-semibold cursor-pointer",
      formFieldInput: "!border-[#333333] !text-white",
      formFieldLabel: "!text-[#C5C5C5] font-semibold",
      footerActionText: "!text-[#9A9A9A]",
      footerActionLink: "!text-[#7C3AED] hover:!text-[#8B5CF6] font-semibold",
      dividerLine: "!bg-[#2B2B2B]",
      dividerText: "!text-[#666666] text-[11px] uppercase px-2",
      socialButtonsBlockButton: "!border-[#333333] hover:!bg-[#222222] !text-white cursor-pointer",
      socialButtonsBlockButtonText: "font-semibold !text-white",
      footer: "!border-t !border-[#2B2B2B] !bg-[#1A1A1A]",
      identityPreviewText: "!text-white",
      formResendCodeLink: "!text-[#7C3AED]",
    },
  };

  return (
    <div className="min-h-screen w-screen bg-[#0A0A0A] text-white flex flex-col lg:flex-row font-sans selection:bg-[#7C3AED]/30 overflow-y-auto">

      {/* LEFT SIDE: SLATE PRODUCT SHOWCASE */}
      <div className="lg:w-1/2 p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden border-b lg:border-b-0 lg:border-r border-[#2B2B2B] bg-[#0A0A0A] min-h-screen">
        
        {/* Glow accents */}
        <div className="absolute top-1/4 left-10 w-96 h-96 bg-[#7C3AED]/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-80 h-80 bg-[#4C1D95]/15 rounded-full blur-[100px] pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-[#808080] hover:text-white transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Home
          </Link>
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Slate Logo" width={24} height={24} className="rounded-lg shadow-sm" />
            <span className="font-bold text-sm tracking-tight text-white">SLATE</span>
          </div>
        </div>

        {/* Main content */}
        <div className="relative z-10 my-6 space-y-6 max-w-lg">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#C5C5C5]">
            <Sparkles className="w-3.5 h-3.5 text-[#7C3AED]" />
            <span>Next-Gen Visual Workspace</span>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight">
              Think. Draw. Collaborate.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-[#C5C5C5] to-[#7C3AED]">
                Build systems at lightspeed.
              </span>
            </h1>
            <p className="text-xs text-[#808080] leading-relaxed">
              Slate combines infinite whiteboard diagramming with real-time markdown documentation and AI architecture tools.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            {[
              { icon: <Layout className="w-4 h-4" />, title: "Infinite Whiteboard Canvas", desc: "Real-time multiplayer diagramming, vector shapes, & connectors." },
              { icon: <FileText className="w-4 h-4" />, title: "Split Markdown Docs", desc: "Write technical docs side-by-side with live architecture diagrams." },
              { icon: <Zap className="w-4 h-4" />, title: "Slate AI Architecture Engine", desc: "Generate system architecture diagrams automatically from text prompts." },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3 p-3 rounded-xl border border-[#2B2B2B] bg-[#141414]/80">
                <div className="p-2 rounded-lg bg-[#1A1A1A] text-[#7C3AED] mt-0.5">{f.icon}</div>
                <div>
                  <h4 className="text-xs font-bold text-white">{f.title}</h4>
                  <p className="text-[11px] text-[#808080]">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-2xl border border-[#2B2B2B] bg-[#141414] space-y-1.5">
            <p className="text-[11px] italic text-[#C5C5C5]">
              &ldquo;Slate has completely revolutionized how our engineering team visualizes microservice architectures.&rdquo;
            </p>
            <div className="flex items-center gap-2 text-[10px] text-[#808080]">
              <span className="font-bold text-white">Staff Systems Architect</span>
              <span>•</span>
              <span>Linear & Figma Standards</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-[#808080]">
          <span>© 2026 Slate Inc. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: CLERK AUTH */}
      <div className="lg:w-1/2 p-6 lg:p-16 flex flex-col items-center justify-center bg-[#0D0D0D] min-h-screen lg:min-h-0">
        
        {/* Log In / Sign Up Toggle */}
        <div className="mb-6 inline-flex p-1 rounded-xl border border-[#2B2B2B] bg-[#141414]">
          <button
            onClick={() => setMode("sign-in")}
            className={`px-5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === "sign-in" ? "bg-[#7C3AED] text-white shadow-sm" : "text-[#808080] hover:text-white"
            }`}
          >
            Log In
          </button>
          <button
            onClick={() => setMode("sign-up")}
            className={`px-5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === "sign-up" ? "bg-[#7C3AED] text-white shadow-sm" : "text-[#808080] hover:text-white"
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Clerk Component */}
        <div className="w-full max-w-md">
          {mode === "sign-in" ? (
            <SignIn appearance={clerkAppearance} signUpUrl="/auth?mode=sign-up" forceRedirectUrl="/dashboard" />
          ) : (
            <SignUp appearance={clerkAppearance} signInUrl="/auth?mode=sign-in" forceRedirectUrl="/dashboard" />
          )}
        </div>

      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-[#0A0A0A]" />}>
      <AuthContent />
    </React.Suspense>
  );
}
