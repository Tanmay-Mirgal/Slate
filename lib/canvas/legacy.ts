import { createPen, textSize } from "./create";
import { guessIcon } from "./icons-catalog";
import { newId } from "./ids";
import type { Binding, ConnectorEl, El, Route, Side } from "./types";
import { normalizeElement } from "./normalize";

/**
 * Converts the schema-v1 canvas (a single JSON array of loosely typed objects, produced by the old
 * page) into v2 elements. Unknown or unusable entries are skipped rather than failing the import.
 */

type Legacy = Record<string, unknown> & {
  id?: string;
  type?: string;
  nodeType?: string;
  lucideIcon?: string | null;
  title?: string;
  subtitle?: string;
  text?: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: { x: number; y: number }[];
  strokeColor?: string;
  fillColor?: string;
  color?: string;
  strokeWidth?: number;
  startNodeId?: string;
  endNodeId?: string;
  sourceAnchor?: Side;
  targetAnchor?: Side;
  connectorStyle?: string;
  imageSrc?: string;
  layerIndex?: number;
  createdAt?: number;
};

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

const NODE_ICONS: Record<string, string> = {
  database: "lucide:Database",
  server: "lucide:Server",
  gateway: "lucide:Waypoints",
  balancer: "lucide:Split",
  cache: "lucide:MemoryStick",
  client: "lucide:Globe",
  storage: "lucide:Archive",
  queue: "lucide:Inbox",
  serverless: "lucide:Zap",
};

/** Old dark-theme literals become theme tokens so they adapt to light mode. */
function mapStroke(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const v = c.trim().toLowerCase();
  if (v === "#fff" || v === "#ffffff" || v === "white") return "ink";
  if (v === "#000" || v === "#000000") return undefined;
  return c;
}

function mapFill(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const v = c.trim().toLowerCase();
  if (v === "transparent") return "transparent";
  if (v === "#141414" || v === "#0d0d0d" || v === "#0a0a0a") return "surface";
  if (v.startsWith("rgba(255, 255, 255") || v.startsWith("rgba(255,255,255")) return "transparent";
  return c;
}

function iconFor(el: Legacy): string | undefined {
  const lucide = str(el.lucideIcon);
  if (lucide && /^[A-Za-z0-9]+$/.test(lucide)) return `lucide:${lucide}`;
  const byType = el.nodeType ? NODE_ICONS[el.nodeType] : undefined;
  return byType ?? guessIcon(el.title, el.text, el.subtitle);
}

function route(style: string | undefined): Route {
  if (style === "straight") return "straight";
  if (style === "curved" || style === "smooth") return "curve";
  return "elbow";
}

export interface LegacyResult {
  elements: El[];
  skipped: number;
}

export function legacyToV2(raw: unknown): LegacyResult {
  const list: Legacy[] = Array.isArray(raw) ? (raw.filter((x) => x && typeof x === "object") as Legacy[]) : [];
  const out: El[] = [];
  let skipped = 0;

  // stable paint order: layerIndex, then array order
  const ordered = list.map((el, i) => ({ el, i })).sort((a, b) => num(a.el.layerIndex, a.i) - num(b.el.layerIndex, b.i) || a.i - b.i);
  const ids = new Set(list.map((e) => str(e.id)).filter(Boolean) as string[]);

  ordered.forEach(({ el }, order) => {
    const id = str(el.id) || newId("l");
    const z = order + 1;
    const x = num(el.x);
    const y = num(el.y);
    const w = Math.abs(num(el.width));
    const h = Math.abs(num(el.height));
    const px = el.width !== undefined && num(el.width) < 0 ? x + num(el.width) : x;
    const py = el.height !== undefined && num(el.height) < 0 ? y + num(el.height) : y;
    const stroke = mapStroke(str(el.strokeColor) ?? str(el.color));
    const fill = mapFill(str(el.fillColor));
    const sw = num(el.strokeWidth, 2);
    const label = str(el.text) ?? str(el.title) ?? "";
    let made: unknown = null;

    switch (el.type) {
      case "node": {
        if (el.nodeType === "icon") {
          made = { id, type: "icon", x: px, y: py, w: Math.max(w, 64), h: Math.max(h, 64), z, icon: iconFor(el) ?? "lucide:Box", label: str(el.title) };
        } else {
          made = {
            id,
            type: "card",
            x: px,
            y: py,
            w: Math.max(w, 160),
            h: Math.max(h, 56),
            z,
            title: str(el.title) || label || "Node",
            subtitle: str(el.subtitle),
            icon: iconFor(el),
          };
        }
        break;
      }
      case "rectangle":
      case "circle":
      case "ellipse":
      case "diamond":
      case "triangle": {
        const shape = el.type === "rectangle" ? "rect" : el.type === "circle" || el.type === "ellipse" ? "ellipse" : el.type;
        made = {
          id,
          type: "shape",
          shape,
          x: px,
          y: py,
          w,
          h,
          z,
          radius: shape === "rect" ? 0 : undefined,
          stroke,
          fill,
          strokeWidth: sw,
          text: label || undefined,
          icon: iconFor({ ...el, title: undefined, text: undefined, subtitle: undefined }),
          fontSize: 14,
          align: "center",
        };
        break;
      }
      case "frame":
      case "sticky": {
        if (el.type === "sticky") {
          made = { id, type: "sticky", x: px, y: py, w: Math.max(w, 120), h: Math.max(h, 100), z, text: label, fill: "#fde68a" };
        } else {
          made = { id, type: "frame", x: px, y: py, w, h, z, title: label || str(el.title) || "", accent: stroke && stroke !== "ink" ? stroke : undefined };
        }
        break;
      }
      case "text": {
        const t = label;
        const size = { fontSize: 15, font: "sans" as const, bold: true };
        const s = textSize(t || " ", { ...size, italic: false });
        made = { id, type: "text", x, y, w: s.w, h: s.h, z, text: t, fontSize: 15, font: "sans", align: "left", bold: true, autoW: true, stroke };
        break;
      }
      case "image": {
        const src = str(el.imageSrc);
        if (src) made = { id, type: "image", x: px, y: py, w: w || 200, h: h || 200, z, src };
        break;
      }
      case "pencil": {
        const pts = Array.isArray(el.points) ? el.points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
        if (pts.length >= 2) {
          const pen = createPen(pts, { stroke: stroke ?? "ink", strokeWidth: sw, opacity: 1 } as never, z);
          made = { ...pen, id, stroke: stroke ?? "ink", strokeWidth: Math.max(2, Math.round(sw)) };
        }
        break;
      }
      case "line":
      case "arrow": {
        const isArrow = el.type === "arrow";
        const hasEnds = !!(el.startNodeId && el.endNodeId && ids.has(el.startNodeId) && ids.has(el.endNodeId));
        const bind = (nodeId: string | undefined, side: Side | undefined): Binding | undefined =>
          nodeId && ids.has(nodeId) ? { id: nodeId, ...(side ? { side } : {}) } : undefined;
        if (hasEnds || el.startNodeId || el.endNodeId) {
          const c: ConnectorEl = {
            id,
            type: "connector",
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            z,
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
            start: bind(el.startNodeId, el.sourceAnchor),
            end: bind(el.endNodeId, el.targetAnchor),
            route: route(el.connectorStyle),
            startHead: "none",
            endHead: isArrow ? "arrow" : "none",
            stroke: stroke && stroke !== "ink" ? stroke : "muted",
            strokeWidth: 2,
            ...(label ? { label } : {}),
          };
          // a connector that lost an endpoint becomes a free arrow near where it used to be
          if (!c.start || !c.end) {
            c.points = [
              { x: x, y: y },
              { x: x + 120, y: y + 40 },
            ];
          }
          made = c;
        } else {
          const c: ConnectorEl = {
            id,
            type: "connector",
            x: Math.min(x, x + num(el.width)),
            y: Math.min(y, y + num(el.height)),
            w,
            h,
            z,
            points: [
              { x, y },
              { x: x + num(el.width), y: y + num(el.height) },
            ],
            route: "straight",
            startHead: "none",
            endHead: isArrow ? "arrow" : "none",
            stroke,
            strokeWidth: sw,
            ...(label ? { label } : {}),
          };
          made = c;
        }
        break;
      }
      default:
        break;
    }

    const normalized = made ? normalizeElement(made) : null;
    if (normalized) out.push(normalized);
    else skipped++;
  });

  return { elements: out, skipped };
}
