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
  MousePointer2
} from "lucide-react";

export default async function Home() {
  // Check auth status on server-side
  const { userId } = await auth();
  const isSelfSignedIn = !!userId;

  return (
    <div className="relative min-h-screen bg-black text-zinc-100 overflow-x-hidden font-sans">
      
      {/* Background Decorative Glows */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[150px] pointer-events-none -z-10" />
      <div className="absolute bottom-10 left-1/3 w-[450px] h-[450px] bg-violet-600/10 rounded-full blur-[130px] pointer-events-none -z-10" />
      
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f0f11_1px,transparent_1px),linear-gradient(to_bottom,#0f0f11_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none -z-10" />

      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md border-b border-zinc-900 bg-black/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group" id="logo-link">
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={40}
              height={40}
              className="rounded-lg shadow-[0_0_15px_rgba(147,51,234,0.15)] group-hover:scale-105 transition-transform duration-300"
            />
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent group-hover:text-white transition-colors duration-300">
              Slate
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#collaborate" className="hover:text-white transition-colors">Collaboration</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          </nav>

          {/* CTA / Auth Button */}
          <div className="flex items-center gap-4">
            {!isSelfSignedIn ? (
              <>
                <SignInButton mode="modal">
                  <button className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors" id="signin-btn">
                    Sign In
                  </button>
                </SignInButton>
                <SignInButton mode="modal">
                  <button className="relative group px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-sm font-semibold text-white shadow-md hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all duration-300" id="getstarted-btn">
                    <span className="relative z-10">Get Started</span>
                    <div className="absolute inset-0 rounded-lg bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </SignInButton>
              </>
            ) : (
              <>
                <Link 
                  href="/dashboard" 
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-white transition-all"
                  id="dashboard-link"
                >
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <UserButton />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center text-center">
        {/* Banner Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/30 bg-purple-500/5 text-xs text-purple-300 mb-6 animate-pulse">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Introducing Slate Collaborative Canvas</span>
        </div>

        {/* Heading */}
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight max-w-4xl leading-[1.15] bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent mb-6">
          Think. Draw.<br />
          <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 bg-clip-text text-transparent">
            Collaborate.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-zinc-400 max-w-2xl leading-relaxed mb-10">
          The infinite collaborative canvas designed for creative teams. Brainstorm, draw wireframes, map user journeys, and work in real-time, all in one beautifully sleek platform.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-20">
          {!isSelfSignedIn ? (
            <SignInButton mode="modal">
              <button className="flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 font-semibold text-white shadow-xl shadow-purple-600/20 hover:shadow-purple-600/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300" id="hero-cta-btn">
                Start Drawing Free
                <ArrowRight className="w-5 h-5" />
              </button>
            </SignInButton>
          ) : (
            <Link 
              href="/dashboard"
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 font-semibold text-white shadow-xl shadow-purple-600/20 hover:shadow-purple-600/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              id="hero-dashboard-btn"
            >
              Open Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          )}
          <a 
            href="#features" 
            className="flex items-center gap-2 px-8 py-4 rounded-xl bg-zinc-900/80 border border-zinc-800 font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all duration-300"
          >
            See How it Works
          </a>
        </div>

        {/* Premium Mockup Canvas */}
        <div className="relative w-full max-w-5xl rounded-2xl border border-zinc-800/80 bg-zinc-950/40 backdrop-blur-sm p-4 shadow-[0_0_50px_rgba(99,102,241,0.15)] overflow-hidden group">
          {/* Header of Canvas Mockup */}
          <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-4 text-zinc-500 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500/40" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/40" />
              <span className="w-3 h-3 rounded-full bg-green-500/40" />
              <span className="ml-2 font-medium text-zinc-400">Untitled Canvas • Live</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400">Collaboration On</span>
              <div className="flex -space-x-1.5">
                <div className="w-5 h-5 rounded-full bg-purple-600 border border-zinc-950 flex items-center justify-center text-[9px] font-bold text-white">S</div>
                <div className="w-5 h-5 rounded-full bg-emerald-600 border border-zinc-950 flex items-center justify-center text-[9px] font-bold text-white">A</div>
                <div className="w-5 h-5 rounded-full bg-amber-600 border border-zinc-950 flex items-center justify-center text-[9px] font-bold text-white">M</div>
              </div>
            </div>
          </div>

          {/* Interactive Canvas Canvas Mockup Drawing */}
          <div className="relative h-[400px] w-full rounded-lg bg-[#070709] overflow-hidden flex items-center justify-center border border-zinc-900">
            {/* Dots Grid Pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(#1f1f29_1px,transparent_1px)] [background-size:16px_16px] opacity-70" />
            
            {/* Fake Drawing UI elements */}
            <svg className="absolute inset-0 w-full h-full p-4 pointer-events-none opacity-85">
              {/* Central flow chart */}
              <rect x="15%" y="40%" width="120" height="60" rx="10" fill="#18181b" stroke="#6366f1" strokeWidth="2" />
              <text x="18%" y="54%" fill="#ffffff" fontSize="13" fontFamily="sans-serif" fontWeight="bold">Think</text>

              <line x1="26%" y1="50%" x2="42%" y2="50%" stroke="#4f46e5" strokeWidth="2" strokeDasharray="5,5" />
              <polygon points="42%,47 42%,53 47%,50" fill="#4f46e5" />
              
              <rect x="47%" y="40%" width="120" height="60" rx="10" fill="#18181b" stroke="#a855f7" strokeWidth="2" />
              <text x="50%" y="54%" fill="#ffffff" fontSize="13" fontFamily="sans-serif" fontWeight="bold">Draw</text>
              
              <line x1="58%" y1="50%" x2="74%" y2="50%" stroke="#4f46e5" strokeWidth="2" strokeDasharray="5,5" />
              <polygon points="74%,47 74%,53 79%,50" fill="#4f46e5" />
              
              <rect x="79%" y="40%" width="120" height="60" rx="10" fill="#18181b" stroke="#ec4899" strokeWidth="2" />
              <text x="81%" y="54%" fill="#ffffff" fontSize="13" fontFamily="sans-serif" fontWeight="bold">Collaborate</text>

              {/* Free hand lines */}
              <path d="M 120 150 Q 200 80, 320 180 T 450 120" fill="none" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
              <circle cx="450" cy="120" r="4" fill="#a855f7" />
            </svg>

            {/* Simulated Live User Cursors */}
            <div className="absolute top-[32%] left-[22%] flex items-center gap-1.5 animate-bounce">
              <MousePointer2 className="w-5 h-5 text-indigo-500 fill-indigo-500 transform -rotate-90 shadow-md" />
              <span className="px-2 py-0.5 rounded-md bg-indigo-500 text-[10px] font-bold text-white shadow-lg">Sarah</span>
            </div>
            
            <div className="absolute bottom-[28%] left-[55%] flex items-center gap-1.5">
              <MousePointer2 className="w-5 h-5 text-purple-500 fill-purple-500 transform -rotate-90 shadow-md" />
              <span className="px-2 py-0.5 rounded-md bg-purple-500 text-[10px] font-bold text-white shadow-lg">Alex</span>
            </div>

            {/* Quick Draw Toolbar Mockup */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-2 p-2 rounded-xl bg-zinc-900/90 border border-zinc-800 shadow-2xl backdrop-blur-md">
              <button className="p-2 rounded-lg bg-purple-600 text-white shadow-inner"><Paintbrush className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"><Users className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"><Layers className="w-4 h-4" /></button>
              <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"><Share2 className="w-4 h-4" /></button>
            </div>

            {/* Canvas Indicator */}
            <div className="absolute top-4 left-4 bg-zinc-900/80 border border-zinc-800 px-3 py-1.5 rounded-lg flex items-center gap-2 text-zinc-400 text-xs">
              <Activity className="w-3.5 h-3.5 text-emerald-500" />
              <span>Real-Time Syncing...</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section id="features" className="py-24 border-t border-zinc-900 bg-zinc-950/20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
              Everything you need to brainstorm effectively
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Slate brings together standard whiteboard tools with ultra-low latency cloud syncing so you never lose your ideas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-8 rounded-2xl border border-zinc-900 bg-zinc-950/60 hover:border-zinc-800 transition-all duration-300 hover:shadow-[0_0_30px_rgba(147,51,234,0.05)] flex flex-col items-start text-left">
              <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 mb-6">
                <Paintbrush className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Infinite Canvas</h3>
              <p className="text-sm leading-relaxed text-zinc-400">
                Draw, type, import files, and link notes together on a zoomable, unbounded canvas without limits.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-2xl border border-zinc-900 bg-zinc-950/60 hover:border-zinc-800 transition-all duration-300 hover:shadow-[0_0_30px_rgba(99,102,241,0.05)] flex flex-col items-start text-left">
              <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400 mb-6">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Live Collaboration</h3>
              <p className="text-sm leading-relaxed text-zinc-400">
                Share slates with colleagues and clients. Work together simultaneously with real-time multiplayer cursors.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-2xl border border-zinc-900 bg-zinc-950/60 hover:border-zinc-800 transition-all duration-300 hover:shadow-[0_0_30px_rgba(236,72,153,0.05)] flex flex-col items-start text-left">
              <div className="p-3 rounded-xl bg-pink-500/10 text-pink-400 mb-6">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Instant Performance</h3>
              <p className="text-sm leading-relaxed text-zinc-400">
                Optimized drawing engine with 60 FPS graphics, hardware acceleration, and seamless responsiveness.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing / CTA Section */}
      <section id="pricing" className="py-24 border-t border-zinc-900 text-center px-6">
        <div className="max-w-4xl mx-auto rounded-3xl border border-zinc-800/60 bg-gradient-to-b from-zinc-900/50 to-zinc-950 p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-purple-500/5 rounded-full blur-[80px] pointer-events-none" />
          
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Start collaborating with Slate today
          </h2>
          <p className="text-zinc-400 max-w-lg mx-auto mb-8">
            Create up to 3 slates for free with real-time editing. Upgrade to Pro for unlimited slates, smart shapes, and priority support.
          </p>

          <div className="flex flex-col items-center gap-4">
            {!isSelfSignedIn ? (
              <SignInButton mode="modal">
                <button className="flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-black font-semibold hover:bg-zinc-200 transition-colors shadow-lg" id="pricing-signup-btn">
                  Create Free Account
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                </button>
              </SignInButton>
            ) : (
              <Link 
                href="/dashboard"
                className="flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-black font-semibold hover:bg-zinc-200 transition-colors shadow-lg"
                id="pricing-dashboard-link"
              >
                Go to Dashboard
                <ArrowRight className="w-5 h-5 text-purple-600" />
              </Link>
            )}
            <span className="text-xs text-zinc-500 font-medium">No credit card required. Cancel anytime.</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-12 px-6 bg-black">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={36}
              height={36}
              className="rounded-md"
            />
            <span className="text-sm font-semibold tracking-wider text-zinc-400">SLATE</span>
          </div>
          <div className="text-xs text-zinc-500">
            &copy; {new Date().getFullYear()} Slate Inc. All rights reserved. Think. Draw. Collaborate.
          </div>
        </div>
      </footer>
    </div>
  );
}
