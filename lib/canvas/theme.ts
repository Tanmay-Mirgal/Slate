import type { FontFamily, ThemeName } from "./types";

export interface ThemeColors {
  bg: string;
  grid: string;
  gridStrong: string;
  ink: string;
  surface: string;
  surface2: string;
  border: string;
  muted: string;
  selection: string;
  selectionFill: string;
  guide: string;
  danger: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  dark: {
    bg: "#0c0c0e",
    grid: "rgba(255,255,255,0.09)",
    gridStrong: "rgba(255,255,255,0.16)",
    ink: "#ededf2",
    surface: "#18181c",
    surface2: "#212126",
    border: "#3a3a44",
    muted: "#8d8d9a",
    selection: "#7c8cff",
    selectionFill: "rgba(124,140,255,0.10)",
    guide: "#ff5fa2",
    danger: "#ef4444",
  },
  light: {
    bg: "#f6f6f8",
    grid: "rgba(0,0,0,0.09)",
    gridStrong: "rgba(0,0,0,0.16)",
    ink: "#1b1b22",
    surface: "#ffffff",
    surface2: "#f0f0f4",
    border: "#cfcfda",
    muted: "#6c6c7a",
    selection: "#4f5bd5",
    selectionFill: "rgba(79,91,213,0.10)",
    guide: "#e0368a",
    danger: "#dc2626",
  },
};

const TOKENS = new Set(["ink", "surface", "surface2", "border", "muted", "bg"]);

/** Accepts a CSS colour or a theme token ("ink", "surface", ...) and returns a CSS colour. */
export function resolveColor(color: string | undefined, theme: ThemeName, fallback = "ink"): string {
  const c = color ?? fallback;
  if (c === "transparent" || c === "none") return "transparent";
  if (TOKENS.has(c)) return THEMES[theme][c as keyof ThemeColors];
  return c;
}

export function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    s = s.slice(1);
    if (s.length === 3 || s.length === 4) s = s.split("").map((c) => c + c).join("");
    if (s.length !== 6 && s.length !== 8) return null;
    const n = parseInt(s.slice(0, 6), 16);
    if (Number.isNaN(n)) return null;
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

export function toHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${alpha})`;
}

export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0.5;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
}

/** Nudges very dark / very light brand colours so they stay legible on the theme background. */
export function readableOn(color: string, theme: ThemeName): string {
  const lum = luminance(color);
  if (theme === "dark" && lum < 0.12) return mix(color, "#ffffff", 0.7);
  if (theme === "dark" && lum < 0.22) return mix(color, "#ffffff", 0.35);
  if (theme === "light" && lum > 0.82) return mix(color, "#000000", 0.55);
  return color;
}

export const ACCENTS = {
  gray: "#8d8d9a",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#a855f7",
  pink: "#ec4899",
} as const;

export type AccentName = keyof typeof ACCENTS;

export const STROKE_PALETTE = ["ink", ...Object.values(ACCENTS)];
export const FILL_PALETTE = [
  "transparent",
  "surface",
  ...Object.values(ACCENTS).map((c) => withAlpha(c, 0.22)),
  ...Object.values(ACCENTS),
];

export const STICKY_COLORS = ["#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fbcfe8", "#fed7aa", "#e5e7eb"];

/** Colour names the AI / DSL may use, mapped to concrete accents. */
export function accentFromName(name: string | undefined, fallback: string = ACCENTS.indigo): string {
  if (!name) return fallback;
  const n = name.trim().toLowerCase();
  if (n in ACCENTS) return ACCENTS[n as AccentName];
  const aliases: Record<string, AccentName> = {
    grey: "gray",
    cyan: "teal",
    lightblue: "blue",
    violet: "purple",
    magenta: "pink",
    amber: "yellow",
    lime: "green",
    brown: "orange",
    black: "gray",
    white: "gray",
  };
  if (aliases[n]) return ACCENTS[aliases[n]];
  if (parseColor(n)) return n;
  return fallback;
}

/* ------------------------------------------------------------------ fonts */

let cachedFamilies: Record<FontFamily, string> | null = null;

const FALLBACK_FAMILIES: Record<FontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  hand: '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
};

export function fontFamilyCss(f: FontFamily = "sans"): string {
  if (typeof document === "undefined") return FALLBACK_FAMILIES[f];
  if (!cachedFamilies) {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    const sans = v("--font-geist-sans");
    const mono = v("--font-geist-mono");
    const hand = v("--font-hand");
    cachedFamilies = {
      sans: sans ? `${sans}, ${FALLBACK_FAMILIES.sans}` : FALLBACK_FAMILIES.sans,
      mono: mono ? `${mono}, ${FALLBACK_FAMILIES.mono}` : FALLBACK_FAMILIES.mono,
      hand: hand ? `${hand}, ${FALLBACK_FAMILIES.hand}` : FALLBACK_FAMILIES.hand,
      serif: FALLBACK_FAMILIES.serif,
    };
  }
  return cachedFamilies[f];
}

export function resetFontCache() {
  cachedFamilies = null;
}

export function fontString(opts: { size: number; family?: FontFamily; bold?: boolean; italic?: boolean }): string {
  return `${opts.italic ? "italic " : ""}${opts.bold ? "600" : "400"} ${opts.size}px ${fontFamilyCss(opts.family)}`;
}
