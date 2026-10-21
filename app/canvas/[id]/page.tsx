"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Activity, Eraser, FileCode2, Frame, GraduationCap, Grid3x3, Hand, Image as ImageIcon, ImagePlus, Loader2, Lock, Maximize, Moon, MousePointer2, Pencil, Sparkles, SquareDashed, StickyNote, Type, ArrowUpRight, Download } from "lucide-react";
import { api } from "@/lib/client/api";
import { useMutation, useQuery } from "@/lib/client/query";
import type { Id } from "@/lib/db/types";
import { AiPanel } from "@/components/ai-panel/ai-panel";
import { PricingModal } from "@/components/billing/PricingModal";
import { BoardShell, useBoardEngine } from "@/components/canvas/BoardShell";
import { ShareSlateDialog } from "@/components/canvas/ShareSlateDialog";
import { useBoardPresence, useBoardSync } from "@/components/canvas/useBoardSync";
import { useBoardSocket } from "@/components/canvas/useBoardSocket";
import type { ViewMode } from "@/components/canvas/TopBar";
import { CommandPalette, type CommandItem } from "@/components/CommandPalette";
import { useDocBridge } from "@/components/editor/doc-bridge";
import type { BillingErrorCode } from "@/lib/billing/limits";
import { boardStats } from "@/lib/canvas/stats";
import { parseDsl } from "@/lib/diagram/dsl";
import { placeGraph } from "@/lib/diagram/insert";
import { starterById } from "@/lib/diagram/starter-templates";

const RichDocumentEditor = dynamic(() => import("@/components/editor/editor").then((m) => m.DocumentEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-zinc-500">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
});

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] px-6 text-center text-white">{children}</div>;
}

export default function CanvasPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const slateId = params.id as Id<"slates">;
  const forceView = search.get("mode") === "view";

  const { user, isLoaded: clerkLoaded } = useUser();
  const slate = useQuery(api.slates.getById, { id: slateId });
  // The document body (and, for boards from before per-element storage, the legacy canvas) is fetched once, apart from the polled metadata.
  const doc = useQuery(api.slates.getDocument, slate ? { id: slateId } : "skip");
  const billing = useQuery(api.billing.getMyBilling);

  const engine = useBoardEngine();
  const rename = useMutation(api.slates.rename);
  const updateDocument = useMutation(api.slates.updateDocument);
  const reportStats = useMutation(api.slates.reportStats);

  const docBridge = useDocBridge();
  const [mode, setMode] = React.useState<ViewMode>("canvas");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [pricing, setPricing] = React.useState<{ open: boolean; reason: BillingErrorCode | null }>({ open: false, reason: null });
  const openPricing = React.useCallback((reason: BillingErrorCode | null = null) => setPricing({ open: true, reason }), []);
  const interviewFromUrl = search.get("interview") === "1" || starterById(search.get("template"))?.interview === true;

  const access = slate === null ? null : slate && doc ? { access: slate.access, legacyElements: doc.legacyElements } : undefined;
  const who = { userId: user?.id ?? null, name: user?.fullName || user?.firstName || "Guest", avatar: user?.imageUrl };
  // The live connection (board changes, writes, cursors) is a WebSocket; both hooks fall back to HTTP polling while it is down.
  const conn = useBoardSocket(slateId, true, who);
  const { ready: boardReady } = useBoardSync(engine, slateId, access, forceView, conn);
  useBoardPresence(engine, slateId, !!slate, who, conn);

  const readOnly = forceView || slate?.access === "view";

  // A board opened from a dashboard starter (?template=...) is filled in once, as soon as it has loaded empty.
  const starter = starterById(search.get("template"));
  const templateApplied = React.useRef(false);
  React.useEffect(() => {
    if (!starter || templateApplied.current || !boardReady) return;
    templateApplied.current = true;
    // The starter is a one-shot instruction: drop it from the URL so a reload doesn't repeat it.
    const clearParam = () => router.replace(`/canvas/${slateId}`, { scroll: false });
    if (!starter.dsl || readOnly || engine.store.size > 0) {
      clearParam(); // the interview starter has no diagram; interview mode itself is remembered per board
      return;
    }
    const { graph, errors } = parseDsl(starter.dsl);
    if (errors.length > 0 || graph.nodes.length === 0) {
      engine.toast("Couldn't load that template", "error");
      clearParam();
      return;
    }
    placeGraph(engine, graph)
      .then(clearParam)
      .catch(() => engine.toast("Couldn't lay out that template", "error"));
  }, [starter, boardReady, readOnly, engine, router, slateId]);

  // Tell the dashboard how big this board is so its card can show live node / connector counts.
  const knownStats = slate?.stats ? `${slate.stats.nodes}:${slate.stats.connectors}` : "";
  React.useEffect(() => {
    if (!boardReady || readOnly) return;
    let last = knownStats;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const { nodes, connectors } = boardStats(engine.store.list());
      const key = `${nodes}:${connectors}`;
      if (key === last) return;
      last = key;
      reportStats({ id: slateId, nodes, connectors }).catch(() => {
        last = ""; // try again on the next change
      });
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, 2500);
    };
    schedule();
    const unsub = engine.store.subscribe(schedule);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [boardReady, readOnly, engine, slateId, reportStats, knownStats]);

  const persistDocument = React.useCallback(
    async (payload: { markdown: string; html: string; json: string }) => {
      if (readOnly) return;
      try {
        await updateDocument({ id: slateId, documentText: payload.markdown, documentJson: payload.json });
      } catch {
        engine.toast("Couldn't save the document", "error");
      }
    },
    [engine, readOnly, slateId, updateDocument]
  );

  const commands = React.useMemo<CommandItem[]>(() => {
    const close = () => setPaletteOpen(false);
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    const c = (id: string, title: string, icon: React.ElementType, action: () => void, shortcut?: string, subtitle?: string): CommandItem => ({
      id: `canvas-${id}`,
      category: "Canvas",
      title,
      subtitle,
      icon,
      shortcut,
      action: run(action),
    });
    return [
      c("select", "Select tool", MousePointer2, () => engine.setTool("select"), "V"),
      c("hand", "Hand tool (pan)", Hand, () => engine.setTool("hand"), "H"),
      c("rect", "Draw a rectangle", SquareDashed, () => engine.setTool("shape", { shape: "rect" }), "R"),
      c("arrow", "Draw an arrow", ArrowUpRight, () => engine.setTool("connector"), "A"),
      c("pen", "Pen", Pencil, () => engine.setTool("pen"), "P"),
      c("text", "Add text", Type, () => engine.setTool("text"), "T"),
      c("sticky", "Add a sticky note", StickyNote, () => engine.setTool("sticky"), "N"),
      c("frame", "Add a frame", Frame, () => engine.setTool("frame"), "F"),
      c("image", "Insert an image", ImageIcon, () => engine.setTool("image"), "I"),
      c("eraser", "Eraser", Eraser, () => engine.setTool("eraser"), "E"),
      c("fit", "Zoom to fit", Maximize, () => engine.fitContent(), "⇧1"),
      c("grid", "Toggle grid", Grid3x3, () => engine.setView({ grid: engine.view.grid === "none" ? "dots" : "none" })),
      c("theme", "Switch canvas theme", Moon, () => engine.setView({ theme: engine.view.theme === "dark" ? "light" : "dark" })),
      c("code", "Diagram as code…", FileCode2, () => engine.onOpenCode?.(), undefined, "Describe a system in text and lay it out automatically"),
      c("ai", "Ask Slate AI to draw something", Sparkles, () => engine.onOpenAi?.(), undefined, "Generate or edit a diagram from a prompt"),
      c("export", "Export…", Download, () => engine.onOpenExport?.(), "⌘⇧E"),
      c("simulate", "Simulate traffic", Activity, () => engine.onToggleSimulation?.(), undefined, "Animate requests along your arrows and flag single points of failure"),
      c("interview", "Toggle system design interview mode", GraduationCap, () => engine.onToggleInterview?.(), undefined, "45-minute timer, requirement checklist and an architecture review"),
      c("snapshot", "Insert canvas snapshot into document", ImagePlus, () => engine.onInsertSnapshot?.(), undefined, "Add a picture of the selection (or the board) to the doc"),
    ];
  }, [engine]);

  /* ------------------------------------------------------------- states */

  if (!clerkLoaded || slate === undefined || (slate !== null && doc === undefined)) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        <p className="text-sm text-zinc-500">Opening your board…</p>
      </Centered>
    );
  }

  if (slate === null) {
    return (
      <Centered>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
          <Lock className="h-5 w-5 text-zinc-400" />
        </div>
        <h1 className="text-lg font-semibold">{user ? "You don’t have access to this board" : "Sign in to open this board"}</h1>
        <p className="max-w-sm text-sm text-zinc-500">
          {user ? "It may have been deleted, or its owner hasn’t shared it with you. Ask them for an invite or an edit link." : "This board is private. Sign in with an account that has access, or ask the owner for a shareable link."}
        </p>
        <div className="flex gap-2">
          {!user && (
            <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/canvas/${slateId}`)}`} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">
              Sign in
            </Link>
          )}
          <Link href="/dashboard" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10">
            Go to dashboard
          </Link>
        </div>
      </Centered>
    );
  }

  return (
    <div className="h-screen w-screen">
      <BoardShell
        engine={engine}
        title={slate.title}
        onRename={slate.canManage && !forceView ? (title) => void rename({ id: slateId, title }).catch(() => engine.toast("Couldn't rename the board", "error")) : undefined}
        backHref="/dashboard"
        mode={mode}
        onModeChange={setMode}
        onOpenCommand={() => setPaletteOpen(true)}
        defaultAiOpen={search.get("ai") === "true"}
        aiLocked={!user}
        tier={billing?.tier ?? "free"}
        onUpgrade={() => openPricing(null)}
        defaultInterview={interviewFromUrl}
        interviewKey={String(slate._id)}
        actions={<ShareSlateDialog slateId={slateId} title={slate.title} workspaceId={slate.workspaceId} linkAccess={slate.linkAccess} canManage={slate.canManage} />}
        docBridge={docBridge}
        docSlot={
          <RichDocumentEditor
            bridge={docBridge}
            onInsertCanvasSnapshot={() => engine.onInsertSnapshot?.()}
            key={String(slate._id)}
            initialMarkdown={doc?.documentText || undefined}
            initialJson={doc?.documentJson || undefined}
            readOnly={readOnly}
            onPersist={persistDocument}
            onSearchCommand={() => setPaletteOpen(true)}
          />
        }
        renderAi={({ isOpen, onClose, onOpenCode }) => (
          <AiPanel engine={engine} isOpen={isOpen} onClose={onClose} signedIn={!!user} onOpenCode={onOpenCode} docBridge={docBridge} onShowDoc={() => setMode("split")} onUpgrade={() => openPricing("credits_exhausted")} />
        )}
      />
      <PricingModal open={pricing.open} onOpenChange={(open) => setPricing((p) => ({ ...p, open }))} reason={pricing.reason} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} extraItems={commands} onNewSlate={() => router.push("/dashboard")} onGoDashboard={() => router.push("/dashboard")} onAiGenerate={() => engine.onOpenAi?.()} />
    </div>
  );
}
