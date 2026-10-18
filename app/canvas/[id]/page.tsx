"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { Eraser, FileCode2, Frame, Grid3x3, Hand, Image as ImageIcon, Loader2, Lock, Maximize, Moon, MousePointer2, Pencil, Sparkles, SquareDashed, StickyNote, Type, ArrowUpRight, Download } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AiPanel } from "@/components/ai-panel/ai-panel";
import { BoardShell, useBoardEngine } from "@/components/canvas/BoardShell";
import { ShareSlateDialog } from "@/components/canvas/ShareSlateDialog";
import { useBoardPresence, useBoardSync } from "@/components/canvas/useBoardSync";
import type { ViewMode } from "@/components/canvas/TopBar";
import { CommandPalette, type CommandItem } from "@/components/CommandPalette";

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

  const { isLoading: authLoading } = useConvexAuth();
  const { user, isLoaded: clerkLoaded } = useUser();
  const slate = useQuery(api.slates.getById, { id: slateId });

  const engine = useBoardEngine();
  const rename = useMutation(api.slates.rename);
  const updateDocument = useMutation(api.slates.updateDocument);

  const [mode, setMode] = React.useState<ViewMode>("canvas");
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const access = slate ? { access: slate.access, legacyElements: slate.legacyElements } : slate;
  useBoardSync(engine, slateId, access, forceView);
  useBoardPresence(engine, slateId, !!slate, {
    userId: user?.id ?? null,
    name: user?.fullName || user?.firstName || "Guest",
    avatar: user?.imageUrl,
  });

  const readOnly = forceView || slate?.access === "view";

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
    ];
  }, [engine]);

  /* ------------------------------------------------------------- states */

  if (authLoading || !clerkLoaded || slate === undefined) {
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
        actions={<ShareSlateDialog slateId={slateId} title={slate.title} workspaceId={slate.workspaceId} linkAccess={slate.linkAccess} canManage={slate.canManage} />}
        docSlot={
          <RichDocumentEditor
            key={String(slate._id)}
            initialMarkdown={slate.documentText || undefined}
            initialJson={slate.documentJson || undefined}
            readOnly={readOnly}
            onPersist={persistDocument}
            onSearchCommand={() => setPaletteOpen(true)}
          />
        }
        renderAi={({ isOpen, onClose, onOpenCode }) => <AiPanel engine={engine} isOpen={isOpen} onClose={onClose} signedIn={!!user} onOpenCode={onOpenCode} />}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} extraItems={commands} onNewSlate={() => router.push("/dashboard")} onGoDashboard={() => router.push("/dashboard")} onAiGenerate={() => engine.onOpenAi?.()} />
    </div>
  );
}
