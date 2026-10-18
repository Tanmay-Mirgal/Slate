"use client";

import * as React from "react";
import { shapePaths } from "@/lib/canvas/shapes";
import type { ShapeKind } from "@/lib/canvas/types";

/** Small outline preview of a shape kind for menus / the library. */
export function ShapePreview({ kind, size = 22, className }: { kind: ShapeKind; size?: number; className?: string }) {
  const w = 24;
  const h = kind === "cylinder" || kind === "star" || kind === "triangle" ? 22 : 16;
  const { d, detail } = shapePaths(kind, w, h, 3);
  return (
    <svg viewBox={`-1.5 -1.5 ${w + 3} ${Math.max(h, 18) + 3}`} width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
      <g transform={`translate(0 ${(Math.max(h, 18) - h) / 2})`}>
        <path d={d} />
        {detail && <path d={detail} />}
      </g>
    </svg>
  );
}
