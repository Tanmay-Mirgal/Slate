"use client";

import * as React from "react";
import { Activity, AlertTriangle, ChevronUp, Square } from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import type { ConnectorEl, Point } from "@/lib/canvas/types";
import type { ConnectorGeom } from "@/lib/canvas/router";
import { flowDirections, findSpofs, type Spof } from "@/lib/simulation/topology";

const SPEEDS = [0.5, 1, 2] as const;
/** World units a packet travels per second at 1x. */
const PACKET_SPEED = 150;
/** Roughly one packet per this many world units of connector. */
const PACKET_SPACING = 120;
const SYNC_COLOR = "#22d3ee";
const ASYNC_COLOR = "#fbbf24";

interface FlowPath {
  geom: ConnectorGeom;
  path: Path2D;
  /** Cumulative length at each point of geom.pts. */
  cum: number[];
  total: number;
}

function buildFlow(geom: ConnectorGeom): FlowPath {
  const cum = [0];
  for (let i = 1; i < geom.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(geom.pts[i].x - geom.pts[i - 1].x, geom.pts[i].y - geom.pts[i - 1].y));
  return { geom, path: new Path2D(geom.path), cum, total: cum[cum.length - 1] || 0 };
}

function pointAt(flow: FlowPath, u: number): Point {
  const pts = flow.geom.pts;
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1 || flow.total === 0) return pts[0];
  const d = Math.min(Math.max(u, 0), 1) * flow.total;
  let i = 1;
  while (i < flow.cum.length - 1 && flow.cum[i] < d) i++;
  const span = flow.cum[i] - flow.cum[i - 1] || 1;
  const k = (d - flow.cum[i - 1]) / span;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k };
}

function usePrefersReducedMotion(): boolean {
  const subscribe = React.useCallback((cb: () => void) => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

interface TrafficSimulatorProps {
  engine: Engine;
  onStop: () => void;
  /** Hide the control panel (presentation mode keeps the animation). */
  hud?: boolean;
}

/**
 * Plays traffic through the diagram: glowing packets travel along every bound connector in the
 * direction of its arrows (amber for dashed / asynchronous links), and components that many others
 * depend on without any redundancy get a pulsing warning badge. It never edits the board.
 */
export function TrafficSimulator({ engine, onStop, hud = true }: TrafficSimulatorProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const badgeRefs = React.useRef(new Map<string, HTMLDivElement>());
  const speedRef = React.useRef(1);
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1);
  const [spofs, setSpofs] = React.useState<Spof[]>(() => findSpofs(engine.store.list()));
  const [flowCount, setFlowCount] = React.useState(() => engine.store.list().filter((e) => e.type === "connector" && e.start && e.end).length);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Re-analyse the topology (debounced) whenever the board changes.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const analyse = () => {
      timer = null;
      const els = engine.store.list();
      const next = findSpofs(els);
      setSpofs((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.message === next[i].message) ? prev : next));
      const flows = els.filter((e) => e.type === "connector" && e.start && e.end).length;
      setFlowCount((prev) => (prev === flows ? prev : flows));
    };
    const unsub = engine.store.subscribe(() => {
      if (!timer) timer = setTimeout(analyse, 200);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [engine]);

  // Animation loop: one overlay canvas drawn in world space with the engine's camera.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cache = new WeakMap<ConnectorGeom, FlowPath>();
    let raf = 0;
    const started = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dpr = engine.dpr || 1;
      const w = engine.width;
      const h = engine.height;
      if (w < 2 || h < 2) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cam = engine.camera;
      const z = cam.zoom;
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * cam.x, dpr * cam.y);
      const view = engine.viewport();
      const t = ((now - started) / 1000) * speedRef.current;
      const radius = Math.max(3.4, 2.4 / z);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const el of engine.store.list()) {
        if (el.type !== "connector" || !el.start || !el.end) continue;
        const geom = engine.geom.connector(el as ConnectorEl);
        const b = geom.bounds;
        if (b.x > view.x + view.w || b.x + b.w < view.x || b.y > view.y + view.h || b.y + b.h < view.y) continue;
        let flow = cache.get(geom);
        if (!flow) {
          flow = buildFlow(geom);
          cache.set(geom, flow);
        }
        if (flow.total < 4) continue;
        const color = (el as ConnectorEl).dash && (el as ConnectorEl).dash !== "solid" ? ASYNC_COLOR : SYNC_COLOR;

        // moving dashes along the drawn route (the canvas twin of animating SVG stroke-dashoffset)
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2 / z;
        ctx.setLineDash([7 / z, 13 / z]);
        ctx.lineDashOffset = reduced ? 0 : -(t * 70) / z;
        ctx.stroke(flow.path);
        ctx.restore();

        if (reduced) continue;
        const count = Math.max(1, Math.min(24, Math.floor(flow.total / PACKET_SPACING)));
        const cycle = flow.total / PACKET_SPEED;
        for (const dir of flowDirections(el as ConnectorEl)) {
          for (let i = 0; i < count; i++) {
            let u = (t / cycle + i / count) % 1;
            if (dir === "backward") u = 1 - u;
            const p = pointAt(flow, u);
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius * 2.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      // keep the warning badges glued to their components
      for (const [id, node] of badgeRefs.current) {
        const el = engine.store.get(id);
        if (!el) {
          node.style.display = "none";
          continue;
        }
        const p = engine.worldToScreen({ x: el.x + el.w, y: el.y });
        const visible = p.x > -20 && p.y > -20 && p.x < w + 20 && p.y < h + 20;
        node.style.display = visible ? "" : "none";
        node.style.transform = `translate(${Math.round(p.x - 12)}px, ${Math.round(p.y - 12)}px)`;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, reduced]);

  const focus = (s: Spof) => {
    const el = engine.store.get(s.id);
    if (!el) return;
    engine.select([s.id]);
    engine.revealPoint({ x: el.x + el.w / 2, y: el.y + el.h / 2 });
  };

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[5]" aria-hidden />

      <div className="pointer-events-none absolute inset-0 z-[25]" aria-hidden={spofs.length === 0}>
        {spofs.map((s) => (
          <div
            key={s.id}
            ref={(node) => {
              if (node) badgeRefs.current.set(s.id, node);
              else badgeRefs.current.delete(s.id);
            }}
            className="pointer-events-auto absolute left-0 top-0"
            onMouseEnter={() => setHovered(s.id)}
            onMouseLeave={() => setHovered((h) => (h === s.id ? null : h))}
          >
            <button type="button" onClick={() => focus(s)} aria-label={`Single point of failure: ${s.message}`} className="relative flex h-6 w-6 items-center justify-center">
              <span className={`absolute inset-0 rounded-full motion-safe:animate-ping ${s.severity === "high" ? "bg-red-500/60" : "bg-amber-400/60"}`} />
              <span className={`relative flex h-5 w-5 items-center justify-center rounded-full border border-black/30 text-black shadow-lg ${s.severity === "high" ? "bg-red-500" : "bg-amber-400"}`}>
                <AlertTriangle className="h-3 w-3" strokeWidth={2.6} />
              </span>
            </button>
            {hovered === s.id && (
              <div role="tooltip" className="absolute left-7 top-0 z-10 w-56 rounded-xl border border-white/10 bg-[#141416]/95 p-2.5 text-[11.5px] leading-snug text-zinc-200 shadow-2xl backdrop-blur-xl">
                <div className={`mb-0.5 text-[10px] font-bold uppercase tracking-wider ${s.severity === "high" ? "text-red-400" : "text-amber-300"}`}>{s.severity === "high" ? "High risk" : "Single point of failure"}</div>
                {s.message}. Add a replica, a standby or an autoscaling group to remove the risk.
              </div>
            )}
          </div>
        ))}
      </div>

      {hud && (
        <div className="pointer-events-auto absolute bottom-[76px] left-1/2 z-30 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 tall:bottom-4" onPointerDown={(e) => e.stopPropagation()}>
          {panelOpen && spofs.length > 0 && (
            <ul className="mb-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#141416]/95 p-2 shadow-2xl backdrop-blur-xl [scrollbar-width:thin]">
              {spofs.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => focus(s)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]">
                    <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${s.severity === "high" ? "text-red-400" : "text-amber-300"}`} />
                    <span className="text-[12px] leading-snug text-zinc-200">{s.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#141416]/90 p-2 shadow-xl backdrop-blur-xl">
            <span className="flex items-center gap-1.5 pl-1.5 text-[12px] font-semibold text-white">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              Simulating traffic
            </span>
            <div className="ml-1 flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Simulation speed">
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} className={`h-6 rounded-md px-2 text-[11px] font-semibold tabular-nums transition-colors ${speed === s ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>
                  {s}×
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              disabled={spofs.length === 0}
              className={`ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors ${spofs.length ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "text-emerald-300"}`}
              title={spofs.length ? "Components many others depend on, without redundancy" : "No single points of failure found"}
            >
              {spofs.length > 0 ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5" /> {spofs.length} SPOF{spofs.length === 1 ? "" : "s"}
                  <ChevronUp className={`h-3 w-3 transition-transform ${panelOpen ? "rotate-180" : ""}`} />
                </>
              ) : (
                <>
                  <Activity className="h-3.5 w-3.5" /> {flowCount > 0 ? "No SPOFs" : "No flows yet"}
                </>
              )}
            </button>
            <button type="button" onClick={onStop} aria-label="Stop simulation" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-zinc-200 hover:bg-white/20">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          </div>
          {flowCount === 0 && <p className="mt-2 rounded-xl border border-white/10 bg-[#141416]/90 px-3 py-2 text-center text-[11.5px] text-zinc-400 backdrop-blur-xl">Connect components with arrows to see traffic flow between them.</p>}
        </div>
      )}
    </>
  );
}
