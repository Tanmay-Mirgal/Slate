"use client";

import * as React from "react";
import type { Engine } from "@/lib/canvas/engine";
import type { Peer } from "@/lib/canvas/types";
import { useUi } from "./hooks";

interface Track {
  el: HTMLDivElement | null;
  x: number;
  y: number;
  seen: boolean;
}

/**
 * Teammates' cursors as DOM nodes (crisp at any zoom, never repainted with the canvas). Positions
 * are eased toward the latest network sample every frame, so 10-15 Hz presence looks like 60 fps.
 */
export function CursorsOverlay({ engine }: { engine: Engine }) {
  const ui = useUi(engine);
  const tracks = React.useRef(new Map<string, Track>());

  React.useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const k = 1 - Math.exp(-dt / 55);
      const cam = engine.camera;
      let moving = false;
      for (const peer of engine.peers) {
        const t = tracks.current.get(peer.sessionId);
        if (!t || !t.el) continue;
        if (!peer.cursor) {
          t.el.style.opacity = "0";
          t.seen = false;
          continue;
        }
        if (!t.seen) {
          t.x = peer.cursor.x;
          t.y = peer.cursor.y;
          t.seen = true;
        } else {
          const dx = peer.cursor.x - t.x;
          const dy = peer.cursor.y - t.y;
          if (Math.abs(dx) + Math.abs(dy) > 0.05) {
            t.x += dx * k;
            t.y += dy * k;
            moving = true;
          }
        }
        const sx = t.x * cam.zoom + cam.x;
        const sy = t.y * cam.zoom + cam.y;
        const inside = sx > -40 && sy > -40 && sx < engine.width + 40 && sy < engine.height + 40;
        t.el.style.opacity = inside ? "1" : "0";
        t.el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
      void moving;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // drop tracks for departed peers
  React.useEffect(() => {
    const ids = new Set(ui.peers.map((p) => p.sessionId));
    for (const id of Array.from(tracks.current.keys())) if (!ids.has(id)) tracks.current.delete(id);
  }, [ui.peers]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      {ui.peers.map((p) => (
        <CursorFlag
          key={p.sessionId}
          peer={p}
          register={(el) => {
            const cur = tracks.current.get(p.sessionId) ?? { el: null, x: 0, y: 0, seen: false };
            cur.el = el;
            tracks.current.set(p.sessionId, cur);
          }}
        />
      ))}
    </div>
  );
}

function CursorFlag({ peer, register }: { peer: Pick<Peer, "name" | "color" | "avatar">; register: (el: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={register}
      className="absolute left-0 top-0 will-change-transform"
      style={{ opacity: 0, transition: "opacity 160ms" }}
    >
      <svg width="18" height="22" viewBox="0 0 18 22" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}>
        <path d="M2 1.5 L2 17.5 L6.2 13.6 L9 20 L11.6 18.9 L8.9 12.6 L14.5 12.4 Z" fill={peer.color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div
        className="absolute left-3.5 top-4 max-w-[160px] truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 text-white shadow-md"
        style={{ background: peer.color }}
      >
        {peer.name}
      </div>
    </div>
  );
}
