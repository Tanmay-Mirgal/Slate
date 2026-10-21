/**
 * Board snapshots for version history. Dependency-free: the server functions build and store them,
 * the browser parses them back, and the playground's local stand-in follows the same policy.
 *
 * Storage shape: ONE JSON array of the board's elements per version, cut into ~200k-character
 * chunks (`versionChunks` rows). A version therefore costs a handful of rows no matter how many
 * elements the board has, and nothing is ever copied element-by-element.
 */

/** Characters per chunk. 200k chars is <= 800 KB even if every char were 4 bytes of UTF-8 (a BSON document may hold 16 MB). */
export const CHUNK_CHARS = 200_000;
/** Refuse to snapshot boards beyond these, so one request never has to hold an unbounded board in memory. */
export const MAX_SNAPSHOT_ELEMENTS = 6000;
export const MAX_SNAPSHOT_BYTES = 4_000_000;
/** Automatic snapshots happen at most this often per board while people are editing. */
export const AUTO_INTERVAL_MS = 10 * 60_000;
/** Newest automatic versions kept per board. */
export const MAX_AUTO_VERSIONS = 30;
/** Named (manual) versions allowed per board. Never pruned automatically. */
export const MAX_MANUAL_VERSIONS = 50;
export const MAX_LABEL = 80;

export type VersionKind = "manual" | "auto";

/** Cuts `text` into chunks of at most `size` chars without ever splitting a surrogate pair (that would not survive UTF-8 storage). */
export function chunkString(text: string, size = CHUNK_CHARS): string[] {
  if (text.length === 0) return [""];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1; // high surrogate: keep the pair together
    }
    if (end <= i) end = Math.min(text.length, i + 2); // degenerate tiny size
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

export const joinChunks = (chunks: readonly string[]) => chunks.join("");

/** FNV-1a over UTF-16 code units, plus the length. Only used to notice "nothing changed since the last version". */
export function contentHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

export interface SnapshotRow {
  eid: string;
  z: number;
  data: string;
}

export interface BuiltSnapshot {
  json: string;
  /** Elements included (rows whose JSON was corrupt are skipped, as the client does). */
  count: number;
  skipped: number;
}

/**
 * Builds the snapshot payload from element rows: a JSON array of element objects whose `id` and
 * `z` come from the row (the same rule the client applies when loading). Order is paint order.
 */
export function buildSnapshot(rows: readonly SnapshotRow[]): BuiltSnapshot {
  const parts: { z: number; id: string; obj: Record<string, unknown> }[] = [];
  let skipped = 0;
  for (const r of rows) {
    try {
      const obj = JSON.parse(r.data);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not an object");
      parts.push({ z: r.z, id: r.eid, obj: { ...(obj as Record<string, unknown>), id: r.eid, z: r.z } });
    } catch {
      skipped++;
    }
  }
  parts.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { json: JSON.stringify(parts.map((p) => p.obj)), count: parts.length, skipped };
}

/** Parses a snapshot payload into raw element objects (callers pass them through `normalizeMany`). */
export function parseSnapshot(chunks: readonly string[]): unknown[] {
  const data = JSON.parse(joinChunks(chunks));
  if (!Array.isArray(data)) throw new Error("This version is damaged");
  return data;
}

export const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/* ----------------------------------------------------------------------- policy */

export function shouldAutoSnapshot(opts: { now: number; lastAutoAt: number | undefined; createdAt: number; intervalMs?: number }): boolean {
  const interval = opts.intervalMs ?? AUTO_INTERVAL_MS;
  // A brand new board waits one interval first; a board that never had an automatic version uses its creation time.
  return opts.now - (opts.lastAutoAt ?? opts.createdAt) >= interval;
}

export interface VersionStub {
  id: string;
  kind: VersionKind;
  createdAt: number;
}

/** Ids of the automatic versions to drop so only the newest `maxAuto` remain. */
export function pruneAuto(versions: readonly VersionStub[], maxAuto = MAX_AUTO_VERSIONS): string[] {
  const autos = versions.filter((v) => v.kind === "auto").sort((a, b) => b.createdAt - a.createdAt);
  return autos.slice(maxAuto).map((v) => v.id);
}

export const cleanLabel = (label: string | undefined): string | undefined => {
  const t = label?.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return t ? t : undefined;
};
