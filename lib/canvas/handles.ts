import { rotatePoint, type Box } from "./geometry";
import type { Point } from "./types";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type HandleId = ResizeHandle | "rotate";

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Normalised (0..1) position of each resize handle on the box. */
export const HANDLE_NORM: Record<ResizeHandle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

export const ROTATE_OFFSET_PX = 26;
export const HANDLE_HIT_PX = 9;

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export function handleWorldPoint(box: Box, id: HandleId, zoom: number): Point {
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  if (id === "rotate") {
    return rotatePoint({ x: c.x, y: box.y - ROTATE_OFFSET_PX / zoom }, c, box.angle || 0);
  }
  const [nx, ny] = HANDLE_NORM[id];
  return rotatePoint({ x: box.x + box.w * nx, y: box.y + box.h * ny }, c, box.angle || 0);
}

/** Mid-edge handles are hidden when the box is too small on screen to separate them from corners. */
export function visibleHandles(box: Box, zoom: number): ResizeHandle[] {
  const small = box.w * zoom < 46 || box.h * zoom < 46;
  return small ? (["nw", "ne", "se", "sw"] as ResizeHandle[]) : RESIZE_HANDLES;
}

export function hitHandle(box: Box, p: Point, zoom: number, rotatable: boolean): HandleId | null {
  const r = HANDLE_HIT_PX / zoom;
  if (rotatable) {
    const rp = handleWorldPoint(box, "rotate", zoom);
    if (Math.hypot(p.x - rp.x, p.y - rp.y) <= r + 2 / zoom) return "rotate";
  }
  for (const id of visibleHandles(box, zoom)) {
    const hp = handleWorldPoint(box, id, zoom);
    if (Math.hypot(p.x - hp.x, p.y - hp.y) <= r) return id;
  }
  return null;
}

/** Cursor to show for a rotated box handle. */
export function cursorForHandle(id: HandleId, angle = 0): string {
  if (id === "rotate") return "grab";
  const order: ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const cursors = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
  const idx = order.indexOf(id);
  const turned = Math.round((angle / (Math.PI / 4)) % 8);
  return cursors[(((idx + turned) % 8) + 8) % 4];
}
