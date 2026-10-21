import type { Anchor } from "@/lib/comments/logic";
import type { El, Point } from "@/lib/canvas/types";

/**
 * Comment anchors. A pin is either free (a point on the board) or attached to an element: then it
 * stores a *fraction* of the element's size, so the pin follows when the element is moved, resized
 * or rotated, and falls back to the last known position if the element is deleted.
 */

/** Connectors have no stable box (their geometry is derived from the nodes they join). */
export const isAnchorable = (el: El): boolean => el.type !== "connector" && el.w > 0 && el.h > 0;

function rotateAround(p: Point, c: Point, angle: number): Point {
  if (!angle) return p;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** The anchor for a click at `world`: attached to `el` when it is an element worth following. */
export function anchorAt(world: Point, el: El | null | undefined): Anchor {
  if (!el || !isAnchorable(el)) return { kind: "point", x: world.x, y: world.y };
  const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const local = rotateAround(world, center, -(el.angle ?? 0));
  const u = Math.max(0, Math.min(1, (local.x - el.x) / el.w));
  const v = Math.max(0, Math.min(1, (local.y - el.y) / el.h));
  return { kind: "element", eid: el.id, u, v, x: world.x, y: world.y };
}

export interface ResolvedAnchor extends Point {
  /** The element this pin follows is gone, so the pin sits where it was last seen. */
  detached: boolean;
}

export function resolveAnchor(anchor: Anchor, get: (id: string) => El | undefined): ResolvedAnchor {
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y, detached: false };
  const el = get(anchor.eid);
  if (!el || el.w <= 0 || el.h <= 0) return { x: anchor.x, y: anchor.y, detached: true };
  const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  const p = rotateAround({ x: el.x + anchor.u * el.w, y: el.y + anchor.v * el.h }, center, el.angle ?? 0);
  return { x: p.x, y: p.y, detached: false };
}
