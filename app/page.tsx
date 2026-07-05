import Link from "next/link";
import Image from "next/image";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { 
  Sparkles, 
  Paintbrush, 
  Users, 
  Zap, 
  ArrowRight, 
  CheckCircle2, 
  Share2, 
  Activity,
  Layers,
  MousePointer2,
  Lock,
  Workflow,
  Sparkle
} from "lucide-react";

export default async function Home() {
  const { userId } = await auth();
  const isSelfSignedIn = !!userId;

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-100 overflow-x-hidden font-sans selection:bg-purple-600/30 selection:text-purple-200">
      
      {/* Background Decorative Glows */}
      <div className="absolute top-[-10%] left-1/4 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse duration-5000" />
      <div className="absolute top-1/4 right-1/4 w-[700px] h-[700px] bg-violet-600/10 rounded-full blur-[160px] pointer-events-none -z-10" />
      <div className="absolute bottom-10 left-1/3 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f23_1px,transparent_1px),linear-gradient(to_bottom,#1f1f23_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none -z-10" />

      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md border-b border-neutral-900 bg-neutral-950/60">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group" id="logo-link">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 p-0.5 shadow-lg shadow-purple-900/20 group-hover:scale-105 transition-all duration-300">
              <div className="w-full h-full rounded-[10px] bg-neutral-950 flex items-center justify-center">
                <Paintbrush className="w-5 h-5 text-purple-400 group-hover:text-purple-300 transition-colors" />
              </div>
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent group-hover:text-white transition-colors duration-300">
              Slate
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-neutral-400">
            <a href="#features" className="hover:text-white transition-colors relative group py-2">
              Features
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-purple-500 group-hover:w-full transition-all duration-300" />
            </a>
            <a href="#collibrate" className="hover:text-white transition-colors relative group py-2">
              Whiteboard
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-purple-500 group-hover:w-full transition-all duration-300" />
            </a>
            <a href="#pricing" className="hover:text-white transition-colors relative group py-2">
              Pricing
              <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-purple-500 group-hover:w-full transition-all duration-300" />
            </a>
          </nav>

          {/* CTA / Auth Button */}
          <div className="flex items-center gap-4">
            {!isSelfSignedIn ? (
              <>
                <SignInButton mode="modal">
                  <button className="px-4 py-2 text-sm font-medium text-neutral-300 hover:text-white transition-colors cursor-pointer" id="signin-btn">
                    Sign In
                  </button>
                </SignInButton>
                <SignInButton mode="modal">
                  <button className="relative group px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-sm font-bold text-white shadow-lg hover:shadow-[0_0_20px_rgba(147,51,234,0.3)] transition-all duration-300 hover:scale-[1.02] cursor-pointer" id="getstarted-btn">
                    Get Started
                  </button>
                </SignInButton>
              </>
            ) : (
              <>
                <Link 
                  href="/dashboard" 
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-sm font-bold text-neutral-200 hover:bg-neutral-800 hover:text-white shadow-md hover:shadow-purple-900/10 hover:border-purple-500/20 transition-all"
                  id="dashboard-link"
                >
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 text-purple-400" />
                </Link>
                <div className="flex items-center justify-center p-1 rounded-full border border-neutral-800 bg-neutral-900">
                  <UserButton />
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center text-center">
        {/* Banner Pill */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/5 text-xs text-purple-300 mb-8 backdrop-blur-sm animate-pulse">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Real-time Multiplayer whiteboards are here</span>
        </div>

        {/* Heading */}
        <h1 className="text-5xl md:text-8xl font-black tracking-tight max-w-5xl leading-[1.08] bg-gradient-to-b from-white via-neutral-100 to-neutral-500 bg-clip-text text-transparent mb-8">
          Think. Draw.<br />
          <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 bg-clip-text text-transparent">
            Collaborate Live.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-neutral-400 max-w-3xl leading-relaxed mb-12">
          Slate is the infinite digital canvas designed for creative developers, designers, and teams. Sketch systems, map user journeys, run retrospectives, and coordinate in real-time.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-5 mb-24">
          {!isSelfSignedIn ? (
            <SignInButton mode="modal">
              <button className="flex items-center gap-2 px-8 py-4.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 font-bold text-white shadow-xl shadow-purple-600/20 hover:shadow-purple-600/40 hover:scale-[1.03] active:scale-[0.97] transition-all duration-300 cursor-pointer" id="hero-cta-btn">
                Start Sketching Free
                <ArrowRight className="w-5 h-5" />
              </button>
            </SignInButton>
          ) : (
            <Link 
              href="/dashboard"
              className="flex items-center gap-2 px-8 py-4.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 font-bold text-white shadow-xl shadow-purple-600/20 hover:shadow-purple-600/40 hover:scale-[1.03] active:scale-[0.97] transition-all duration-300"
              id="hero-dashboard-btn"
            >
              Open Your Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          )}
          <a 
            href="#features" 
            className="flex items-center gap-2 px-8 py-4.5 rounded-2xl bg-neutral-900 border border-neutral-800 font-bold text-neutral-300 hover:bg-neutral-800 hover:text-white transition-all duration-300"
          >
            Explore Features
          </a>
        </div>

        {/* Premium Mockup Canvas */}
        <div className="relative w-full max-w-5xl rounded-3xl border border-neutral-800/80 bg-neutral-950/40 backdrop-blur-md p-5 shadow-[0_0_80px_rgba(147,51,234,0.12)] overflow-hidden group">
          {/* Header of Canvas Mockup */}
          <div className="flex items-center justify-between border-b border-neutral-900 pb-4 mb-5 text-neutral-500 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-red-500/20 border border-red-500/30" />
              <span className="w-3.5 h-3.5 rounded-full bg-yellow-500/20 border border-yellow-500/30" />
              <span className="w-3.5 h-3.5 rounded-full bg-green-500/20 border border-green-500/30" />
              <span className="ml-2.5 font-semibold text-neutral-400 bg-neutral-900 px-2.5 py-0.5 rounded-md border border-neutral-800">
                ✨ system-architecture.slate • Live
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[10px] font-bold text-purple-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                Live Sync
              </span>
              <div className="flex -space-x-2">
                <div className="w-6 h-6 rounded-full bg-purple-600 border-2 border-neutral-950 flex items-center justify-center text-[9px] font-bold text-white shadow-md">T</div>
                <div className="w-6 h-6 rounded-full bg-emerald-600 border-2 border-neutral-950 flex items-center justify-center text-[9px] font-bold text-white shadow-md">S</div>
                <div className="w-6 h-6 rounded-full bg-amber-600 border-2 border-neutral-950 flex items-center justify-center text-[9px] font-bold text-white shadow-md">K</div>
              </div>
            </div>
          </div>

          {/* Interactive Canvas Canvas Mockup Drawing */}
          <div className="relative h-[450px] w-full rounded-2xl bg-[#08080a] overflow-hidden flex items-center justify-center border border-neutral-900">
            {/* Dots Grid Pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(#26262c_1px,transparent_1px)] [background-size:20px_20px] opacity-80" />
            
            {/* Drawing UI vector overlay */}
            <svg className="absolute inset-0 w-full h-full p-6 pointer-events-none opacity-90">
              {/* Flowchart nodes */}
              <rect x="10%" y="35%" width="130" height="70" rx="14" fill="#0f0f13" stroke="#6366f1" strokeWidth="2" className="shadow-lg" />
              <text x="14%" y="54%" fill="#ffffff" fontSize="13" fontFamily="sans-serif" fontWeight="700">Client UI</text>
              <text x="14%" y="68%" fill="#6366f1" fontSize="10" fontFamily="sans-serif">React / Next.js</text>

              <line x1="23%" y1="52%" x2="38%" y2="52%" stroke="#4f46e5" strokeWidth="2.5" strokeDasharray="6,6" />
              <polygon points="38%,48 38%,56 44%,52" fill="#4f46e5" />
              
              <rect x="44%" y="35%" width="130" height="70" rx="14" fill="#0f0f13" stroke="#a855f7" strokeWidth="2" />
              <text x="48%" y="54%" fill="#ffffff" fontSize="13" fontFamily="sans-serif" fontWeight="700">Convex DB</text>
              <text x="48%" y="68%" fill="#a855f7" fontSize="10" fontFamily="sans-serif">Realtime Sync</text>
              
              <line x1="57%" y1="52%" x2="72%" y2="52%" stroke="#db2777" strokeWidth="2.5" strokeDasharray="6,6" />
              <polygon points="72%,48 72%,56 78%,52" fill="#db2777" />
              
              <rect x="78%" y="35%" width="130" height="70" rx="14" fill="#0f0f13" stroke="#db2777" strokeWidth="2" />
              <text x="82%" y="54%" fill="#ffffff" fontSize="13" fontFamily="sans-serif" fontWeight="700">Clerk Auth</text>
              <text x="82%" y="68%" fill="#db2777" fontSize="10" fontFamily="sans-serif">JWT verification</text>

              {/* Connected curves */}
              <path d="M 175 140 Q 300 20, 480 140" fill="none" stroke="#6366f1" strokeWidth="2" strokeDasharray="4,4" />
              <path d="M 515 210 Q 640 380, 845 210" fill="none" stroke="#db2777" strokeWidth="2" strokeDasharray="4,4" />
            </svg>

            {/* Simulated Live User Cursors */}
            <div className="absolute top-[30%] left-[18%] flex items-center gap-2 animate-bounce">
              <MousePointer2 className="w-5 h-5 text-indigo-500 fill-indigo-500 transform -rotate-90 filter drop-shadow-md" />
              <span className="px-2.5 py-1 rounded-lg bg-indigo-500 text-[10px] font-bold text-white shadow-lg">Tanmay</span>
            </div>
            
            <div className="absolute bottom-[25%] left-[52%] flex items-center gap-2">
              <MousePointer2 className="w-5 h-5 text-purple-500 fill-purple-500 transform -rotate-90 filter drop-shadow-md" />
              <span className="px-2.5 py-1 rounded-lg bg-purple-500 text-[10px] font-bold text-white shadow-lg">Clerk Bot</span>
            </div>

            {/* Quick Draw Toolbar Mockup */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-2.5 p-2 rounded-2xl bg-neutral-900/90 border border-neutral-800 shadow-2xl backdrop-blur-md">
              <button className="p-3 rounded-xl bg-purple-600 text-white shadow-inner"><Paintbrush className="w-4 h-4" /></button>
              <button className="p-3 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"><Users className="w-4 h-4" /></button>
              <button className="p-3 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"><Layers className="w-4 h-4" /></button>
              <button className="p-3 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"><Share2 className="w-4 h-4" /></button>
            </div>

            {/* Canvas Indicator */}
            <div className="absolute top-4 left-4 bg-neutral-900/80 border border-neutral-800 px-3.5 py-2 rounded-xl flex items-center gap-2.5 text-neutral-300 text-xs">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="font-medium">Active Canvas Sync</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section id="features" className="py-32 border-t border-neutral-900 bg-neutral-950/40 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-24">
            <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-6">
              Designed for Speed and Collaboration
            </h2>
            <p className="text-neutral-400 text-lg max-w-2xl mx-auto">
              Slate aggregates powerful vector sketching tools and low-latency synchronization engines into a highly optimized client interface.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="group p-8 rounded-3xl border border-neutral-900 bg-neutral-950/60 hover:border-purple-500/20 hover:bg-neutral-900/20 transition-all duration-300 hover:shadow-[0_0_30px_rgba(147,51,234,0.04)] flex flex-col items-start text-left">
              <div className="p-3.5 rounded-2xl bg-purple-500/10 text-purple-400 mb-8 border border-purple-500/10 group-hover:scale-110 transition-transform">
                <Paintbrush className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Infinite Drawing Engine</h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                Create system charts, custom drawings, flow mockups, and interface schemas without size restrictions or raster pixel limits.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group p-8 rounded-3xl border border-neutral-900 bg-neutral-950/60 hover:border-indigo-500/20 hover:bg-neutral-900/20 transition-all duration-300 hover:shadow-[0_0_30px_rgba(99,102,241,0.04)] flex flex-col items-start text-left">
              <div className="p-3.5 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-8 border border-indigo-500/10 group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Instant Multiplayer</h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                Co-draw and brainstorm with team members simultaneously. Live cursor pointers make collaboration feel immediate.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group p-8 rounded-3xl border border-neutral-900 bg-neutral-950/60 hover:border-pink-500/20 hover:bg-neutral-900/20 transition-all duration-300 hover:shadow-[0_0_30px_rgba(236,72,153,0.04)] flex flex-col items-start text-left">
              <div className="p-3.5 rounded-2xl bg-pink-500/10 text-pink-400 mb-8 border border-pink-500/10 group-hover:scale-110 transition-transform">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">60 FPS Hardware Acceleration</h3>
              <p className="text-sm leading-relaxed text-neutral-400">
                Vector lines render seamlessly with optimized canvas pipelines, maintaining buttery-smooth interactions as your project grows.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing / CTA Section */}
      <section id="pricing" className="py-24 border-t border-neutral-900 text-center px-6">
        <div className="max-w-4xl mx-auto rounded-3xl border border-neutral-800/80 bg-gradient-to-b from-neutral-900/30 to-neutral-950 p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-purple-600/5 rounded-full blur-[100px] pointer-events-none" />
          
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Build your ideas on Slate
          </h2>
          <p className="text-neutral-400 max-w-lg mx-auto mb-10 text-sm md:text-base leading-relaxed">
            Create infinite digital whiteboards, structure systems, and collaborate with your team. Get started for free today.
          </p>

          <div className="flex flex-col items-center gap-4">
            {!isSelfSignedIn ? (
              <SignInButton mode="modal">
                <button className="flex items-center gap-2.5 px-8 py-4.5 rounded-2xl bg-white text-black font-bold hover:bg-neutral-200 transition-colors shadow-lg cursor-pointer" id="pricing-signup-btn">
                  Create Free Account
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                </button>
              </SignInButton>
            ) : (
              <Link 
                href="/dashboard"
                className="flex items-center gap-2.5 px-8 py-4.5 rounded-2xl bg-white text-black font-bold hover:bg-neutral-200 transition-colors shadow-lg"
                id="pricing-dashboard-link"
              >
                Go to Dashboard
                <ArrowRight className="w-5 h-5 text-purple-600" />
              </Link>
            )}
            <span className="text-xs text-neutral-500 font-semibold uppercase tracking-wider">No Credit Card Required • Instant Setup</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-900 py-16 px-6 bg-neutral-950">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 p-0.5">
              <div className="w-full h-full rounded-[6px] bg-neutral-950 flex items-center justify-center">
                <Paintbrush className="w-4 h-4 text-purple-400" />
              </div>
            </div>
            <span className="text-sm font-bold tracking-wider text-neutral-400">SLATE INC.</span>
          </div>
          <div className="text-xs text-neutral-500">
            &copy; {new Date().getFullYear()} Slate. Think. Draw. Collaborate. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
