"use client";

import * as React from "react";
import type { Engine } from "@/lib/canvas/engine";
import { PointerController } from "@/lib/canvas/pointer";
import { ContextMenu } from "./ContextMenu";
import { CursorsOverlay } from "./CursorsOverlay";
import { TextEditor } from "./TextEditor";
import { EngineProvider, useUi } from "./hooks";

/** The drawing surface: canvas + input handling + text editor + teammates' cursors. */
export function CanvasBoard({ engine, children }: { engine: Engine; children?: React.ReactNode }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    engine.attach(canvas, host);
    const pointer = new PointerController(engine);
    pointer.attach(host);
    return () => {
      pointer.detach();
      engine.detach();
    };
  }, [engine]);

  return (
    <EngineProvider engine={engine}>
      <div
        ref={hostRef}
        className="absolute inset-0 touch-none select-none overflow-hidden outline-none"
        data-slate-canvas
        tabIndex={-1}
        onDragOver={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />
        <CursorsOverlay engine={engine} />
        <TextEditor engine={engine} />
        <ContextMenuHost engine={engine} />
      </div>
      {children}
    </EngineProvider>
  );
}

function ContextMenuHost({ engine }: { engine: Engine }) {
  const ui = useUi(engine);
  if (!ui.contextMenu) return null;
  return <ContextMenu engine={engine} menu={ui.contextMenu} />;
}
