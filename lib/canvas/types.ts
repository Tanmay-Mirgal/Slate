/**
 * Slate canvas document model (v2).
 *
 * One element == one row in the backend. Everything here is plain JSON so it
 * can be persisted, diffed and sent over the wire without custom codecs.
 * Colours may be a CSS colour or a theme token (see theme.ts).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "top" | "right" | "bottom" | "left";

export type ShapeKind =
  | "rect"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "hexagon"
  | "parallelogram"
  | "cylinder"
  | "cloud"
  | "stadium"
  | "document"
  | "star";

export type Dash = "solid" | "dashed" | "dotted";
export type TextAlign = "left" | "center" | "right";
export type FontFamily = "sans" | "mono" | "hand" | "serif";
export type ArrowHead = "none" | "arrow" | "triangle" | "diamond" | "dot" | "bar";
export type Route = "straight" | "elbow" | "curve";

/** Connector endpoint attachment. `side` undefined => pick the facing side automatically. */
export interface Binding {
  id: string;
  side?: Side;
  /** Position along `side`, 0..1 (default 0.5). */
  t?: number;
}

export interface BaseEl {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, rotation about the element centre. */
  angle?: number;
  /** Paint order; higher is on top. Fractional values are allowed. */
  z: number;
  groupId?: string;
  locked?: boolean;
  opacity?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: Dash;
  /** Set on elements produced by AI / diagram-as-code so they can be revised as a unit. */
  diagramId?: string;
}

export interface ShapeEl extends BaseEl {
  type: "shape";
  shape: ShapeKind;
  radius?: number;
  text?: string;
  fontSize?: number;
  font?: FontFamily;
  align?: TextAlign;
  bold?: boolean;
  italic?: boolean;
  icon?: string;
  /** Text colour; defaults to the theme ink colour. */
  color?: string;
}

export interface TextEl extends BaseEl {
  type: "text";
  text: string;
  fontSize: number;
  font: FontFamily;
  align: TextAlign;
  bold?: boolean;
  italic?: boolean;
  /** Width follows content until the user resizes it. */
  autoW?: boolean;
}

export interface StickyEl extends BaseEl {
  type: "sticky";
  text: string;
  fontSize?: number;
  font?: FontFamily;
}

export interface FrameEl extends BaseEl {
  type: "frame";
  title: string;
  accent?: string;
}

export interface CardEl extends BaseEl {
  type: "card";
  title: string;
  subtitle?: string;
  icon?: string;
  /** Accent colour for the icon tile. */
  accent?: string;
}

export interface IconEl extends BaseEl {
  type: "icon";
  icon: string;
  label?: string;
  accent?: string;
}

export interface TableColumn {
  name: string;
  type?: string;
  key?: "pk" | "fk" | "unique";
}

export interface TableEl extends BaseEl {
  type: "table";
  title: string;
  columns: TableColumn[];
  accent?: string;
}

export interface ConnectorEl extends BaseEl {
  type: "connector";
  /** World-space polyline. For bound connectors this is only a cached route. */
  points: Point[];
  start?: Binding;
  end?: Binding;
  route: Route;
  startHead: ArrowHead;
  endHead: ArrowHead;
  label?: string;
  /** Position of the label along the path, 0..1 (default 0.5). */
  labelT?: number;
  /** Signature of the endpoints `points` was computed for (see router.routeSignature). */
  routeSig?: string;
  fontSize?: number;
}

export interface PenEl extends BaseEl {
  type: "pen";
  /** Flat [x0,y0,x1,y1,...] relative to (x,y). */
  pts: number[];
  highlighter?: boolean;
}

export interface ImageEl extends BaseEl {
  type: "image";
  src: string;
  alt?: string;
}

export type El =
  | ShapeEl
  | TextEl
  | StickyEl
  | FrameEl
  | CardEl
  | IconEl
  | TableEl
  | ConnectorEl
  | PenEl
  | ImageEl;

export type ElType = El["type"];

export type Op = { t: "put"; el: El } | { t: "del"; id: string };

export interface Camera {
  /** Screen-space translation in CSS pixels. screen = world * zoom + (x, y). */
  x: number;
  y: number;
  zoom: number;
}

export type ToolId =
  | "select"
  | "hand"
  | "shape"
  | "connector"
  | "line"
  | "pen"
  | "highlighter"
  | "text"
  | "sticky"
  | "frame"
  | "image"
  | "icon"
  | "eraser"
  /** Drops a comment pin; never edits the board, so it works for people who can only comment. */
  | "comment";

export type ThemeName = "dark" | "light";

export type GridKind = "none" | "dots" | "lines";

export interface ViewSettings {
  theme: ThemeName;
  grid: GridKind;
  snapToGrid: boolean;
  snapToObjects: boolean;
  gridSize: number;
}

export interface Peer {
  sessionId: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
  /** World-space cursor position, null when the pointer left the board. */
  cursor: Point | null;
  selection: string[];
  /** In-progress element being drawn (already in world coordinates). */
  draft: El | null;
  /** Live drag preview: element ids translated by (dx, dy). */
  drag: { ids: string[]; dx: number; dy: number } | null;
  tool?: ToolId;
  lastSeen: number;
}

export interface LocalPresence {
  cursor: Point | null;
  selection: string[];
  draft: El | null;
  drag: { ids: string[]; dx: number; dy: number } | null;
  tool: ToolId;
}

export const isLine = (el: El): el is ConnectorEl => el.type === "connector";
export const isPen = (el: El): el is PenEl => el.type === "pen";
export const isContainer = (el: El): el is FrameEl => el.type === "frame";
/** Elements connectors can attach to and route around. */
export const isNodeLike = (el: El): boolean =>
  el.type === "shape" ||
  el.type === "card" ||
  el.type === "icon" ||
  el.type === "table" ||
  el.type === "sticky" ||
  el.type === "image" ||
  el.type === "text" ||
  el.type === "frame";
