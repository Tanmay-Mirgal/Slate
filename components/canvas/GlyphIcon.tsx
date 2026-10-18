"use client";

import * as React from "react";
import { getGlyph, glyphSvgAttrs } from "@/lib/canvas/icons";
import { readableOn } from "@/lib/canvas/theme";

/** Renders any icon key (lucide:/brand:/svc:) as inline SVG. */
export function GlyphIcon({
  iconKey,
  size = 20,
  color,
  className,
}: {
  iconKey: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const glyph = getGlyph(iconKey);
  if (!glyph) return <span className={className} style={{ width: size, height: size, display: "inline-block" }} />;
  const c = color ?? (glyph.color ? readableOn(glyph.color, "dark") : "currentColor");
  const attrs = glyphSvgAttrs(glyph, c);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={attrs.fill}
      stroke={attrs.stroke}
      strokeWidth={attrs.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={glyph.d} />
    </svg>
  );
}
