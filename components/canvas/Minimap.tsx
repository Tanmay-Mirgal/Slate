"use client";

import * as React from "react";
import type { Engine } from "@/lib/canvas/engine";
import { THEMES } from "@/lib/canvas/theme";
import { useCameraVersion, useUi } from "./hooks";

const W = 188;
const H = 120;

/** Bird's-eye view of the whole board; click or drag to navigate. */
export function Minimap({ engine }: { engine: Engine }) {
  const ui = useUi(engine);
  useCameraVersion(engine);
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const dragging = React.useRef(false);

  const content = engine.contentBounds();
  const vp = engine.viewport();
  const union = content
    ? {
        x: Math.min(content.x, vp.x),
        y: Math.min(content.y, vp.y),
        w: Math.max(content.x + content.w, vp.x + vp.w) - Math.min(content.x, vp.x),
        h: Math.max(content.y + content.h, vp.y + vp.h) - Math.min(content.y, vp.y),
      }
    : vp;
  const pad = Math.max(union.w, union.h) * 0.06;
  const world = { x: union.x - pad, y: union.y - pad, w: union.w + pad * 2, h: union.h + pad * 2 };
  const scale = Math.min(W / world.w, H / world.h);
  const ox = (W - world.w * scale) / 2;
  const oy = (H - world.h * scale) / 2;

  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = THEMES[ui.view.theme];
    ctx.clearRect(0, 0, W, H);
    for (const el of engine.store.list()) {
      const b = engine.geom.bounds(el);
      const x = ox + (b.x - world.x) * scale;
      const y = oy + (b.y - world.y) * scale;
      const w = Math.max(1.5, b.w * scale);
      const h = Math.max(1.5, b.h * scale);
      ctx.fillStyle = el.type === "frame" ? colors.border : el.type === "connector" || el.type === "pen" ? colors.muted : colors.ink;
      ctx.globalAlpha = el.type === "frame" ? 0.35 : el.type === "connector" || el.type === "pen" ? 0.6 : 0.8;
      if (el.type === "connector") ctx.fillRect(x, y, Math.max(1, w), Math.max(1, h));
      else ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.selection;
    ctx.fillStyle = colors.selectionFill;
    ctx.lineWidth = 1.5;
    const vx = ox + (vp.x - world.x) * scale;
    const vy = oy + (vp.y - world.y) * scale;
    ctx.fillRect(vx, vy, vp.w * scale, vp.h * scale);
    ctx.strokeRect(vx, vy, vp.w * scale, vp.h * scale);
  });

  const go = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const wx = world.x + (clientX - r.left - ox) / scale;
    const wy = world.y + (clientY - r.top - oy) / scale;
    const z = engine.camera.zoom;
    engine.setCamera({ zoom: z, x: engine.width / 2 - wx * z, y: engine.height / 2 - wy * z });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#141416]/90 shadow-xl backdrop-blur-xl" onPointerDown={(e) => e.stopPropagation()}>
      <canvas
        ref={ref}
        style={{ width: W, height: H, cursor: "pointer", touchAction: "none" }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          go(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => dragging.current && go(e.clientX, e.clientY)}
        onPointerUp={() => (dragging.current = false)}
      />
    </div>
  );
}
