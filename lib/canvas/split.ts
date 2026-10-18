import type { Camera } from "./types";

/** localStorage key for the document/canvas split position (percentage of the width the doc pane takes). */
export const SPLIT_KEY = "slate_split_ratio";
export const SPLIT_MIN = 20;
export const SPLIT_MAX = 80;
export const SPLIT_DEFAULT = 50;

export const SPLIT_PRESETS = [
  { id: "doc30", label: "30% Doc", ratio: 30 },
  { id: "even", label: "50/50", ratio: 50 },
  { id: "doc70", label: "70% Doc", ratio: 70 },
] as const;

/** Keeps a ratio inside [SPLIT_MIN, SPLIT_MAX]; anything that isn't a finite number falls back to 50. */
export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

/** Reads a stored value defensively: corrupt or hand-edited storage must never break the layout. */
export function parseSplit(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return SPLIT_DEFAULT;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clampSplit(n) : SPLIT_DEFAULT;
}

/** Pointer position -> doc pane percentage, relative to the container that holds both panes. */
export function splitFromPointer(clientX: number, containerLeft: number, containerWidth: number): number {
  if (!(containerWidth > 0)) return SPLIT_DEFAULT;
  return clampSplit(((clientX - containerLeft) / containerWidth) * 100);
}

/**
 * New camera after the canvas host changed size.
 *
 * `start` keeps the top-left world point fixed (the engine's long-standing behaviour). `center`
 * keeps the world point at the middle of the viewport fixed, so dragging the split handle grows
 * and shrinks the visible area symmetrically instead of sliding the drawing sideways.
 */
export function cameraAfterResize(camera: Camera, from: { w: number; h: number }, to: { w: number; h: number }, anchor: "start" | "center"): Camera {
  if (anchor === "start" || from.w <= 0 || from.h <= 0) return camera;
  return { ...camera, x: camera.x + (to.w - from.w) / 2, y: camera.y + (to.h - from.h) / 2 };
}
