"use client";

import * as React from "react";
import Link from "next/link";
import { AiPanel } from "@/components/ai-panel/ai-panel";
import { BoardShell, useBoardEngine } from "@/components/canvas/BoardShell";
import { cardSize, createCard, createConnector, createFrame, createShape, createSticky, DEFAULT_STYLE } from "@/lib/canvas/create";
import { LocalBoard } from "@/lib/canvas/local-board";
import type { El } from "@/lib/canvas/types";

const STORAGE_KEY = "slate-playground-v2";

function seed(): El[] {
  const style = DEFAULT_STYLE;
  const mk = (title: string, subtitle: string, icon: string, x: number, y: number, z: number) => {
    const { w, h } = cardSize(title, subtitle, true);
    return createCard({ x, y, w, h }, z, { title, subtitle, icon });
  };
  const client = mk("Web client", "Next.js", "brand:nextdotjs", 0, 60, 3);
  const api = mk("API gateway", "Auth · rate limits", "lucide:Waypoints", 340, 60, 4);
  const svc = mk("Orders service", "Node.js", "brand:nodedotjs", 700, -40, 5);
  const db = mk("PostgreSQL", "Primary store", "brand:postgresql", 1060, -40, 6);
  const cache = mk("Redis", "Session cache", "brand:redis", 700, 160, 7);
  const edge = (a: El, b: El, label: string | undefined, z: number) =>
    createConnector({ x: a.x, y: a.y }, { x: b.x, y: b.y }, style, z, { start: { id: a.id }, end: { id: b.id }, label });
  const frame = createFrame({ x: -40, y: -140, w: 1420, h: 460 }, 0, "Production");
  const note = createSticky({ x: 360, y: 280, w: 220, h: 150 }, style, 12);
  note.text = "Welcome to Slate ✨\nDrag, draw, connect.\nPress ? for shortcuts";
  const shape = createShape("diamond", { x: 1080, y: 170, w: 150, h: 110 }, style, 13);
  shape.text = "Cache hit?";
  return [frame, client, api, svc, db, cache, edge(client, api, "HTTPS", 1), edge(api, svc, "gRPC", 1), edge(svc, db, "SQL", 1), edge(svc, cache, undefined, 1), note, shape];
}

/** Free, no-account board stored in this browser. Client-only so it can read localStorage up front. */
export default function PlaygroundClient() {
  const engine = useBoardEngine();
  const [board] = React.useState(() => new LocalBoard(STORAGE_KEY, "Playground"));
  const [title, setTitle] = React.useState(board.title);

  React.useEffect(() => {
    board.attach(engine, seed);
    return () => board.detach(engine);
  }, [board, engine]);

  return (
    <div className="h-screen w-screen">
      <BoardShell
        engine={engine}
        title={title}
        onRename={(t) => {
          setTitle(t);
          board.setTitle(t, engine);
        }}
        backHref="/"
        aiLocked
        renderAi={({ isOpen, onClose, onOpenCode }) => <AiPanel engine={engine} isOpen={isOpen} onClose={onClose} signedIn={false} onOpenCode={onOpenCode} />}
        actions={
          <Link href="/sign-up" className="flex h-8 items-center rounded-xl bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-zinc-200 max-sm:hidden">
            Sign up to sync
          </Link>
        }
      />
    </div>
  );
}
