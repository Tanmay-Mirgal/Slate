/**
 * Pure comment rules shared by the Convex functions, the browser UI and the playground's local
 * stand-in, so all three agree on limits, anchors, mentions and what "unread" means.
 * Dependency-free on purpose (like shards.ts): no Convex or DOM imports.
 */

export const MAX_BODY = 2000;
export const MAX_MENTIONS = 20;
export const MAX_THREADS_PER_SLATE = 500;
export const MAX_MESSAGES_PER_THREAD = 200;
/** Threads returned by `comments.list` (newest activity first). */
export const LIST_LIMIT = 400;
export const SNIPPET_CHARS = 160;
const COORD = 1e7;

export type Anchor =
  | { kind: "point"; x: number; y: number }
  /**
   * Pinned to a spot *on an element*: `u`/`v` are fractions (0..1) of its width/height, so the pin
   * follows the element when it moves, resizes or rotates. `x`/`y` are the last known world position,
   * used if the element is deleted.
   */
  | { kind: "element"; eid: string; u: number; v: number; x: number; y: number };

const finite = (n: unknown, d = 0): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(-COORD, Math.min(COORD, n)) : d);
const unit = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);

/** Clamps and validates an anchor from the network. Returns null when it cannot be pinned anywhere. */
export function sanitizeAnchor(raw: unknown): Anchor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.kind === "point") {
    if (typeof a.x !== "number" || typeof a.y !== "number" || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
    return { kind: "point", x: finite(a.x), y: finite(a.y) };
  }
  if (a.kind === "element") {
    if (typeof a.eid !== "string" || a.eid.length === 0 || a.eid.length > 80) return null;
    if (typeof a.x !== "number" || typeof a.y !== "number" || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
    return { kind: "element", eid: a.eid, u: unit(a.u), v: unit(a.v), x: finite(a.x), y: finite(a.y) };
  }
  return null;
}

/** Trims, normalises line endings and caps the length. Empty (whitespace only) comes back as "". */
export function cleanBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim().slice(0, MAX_BODY);
}

export function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS - 1)}…` : flat;
}

/** De-duplicates and caps mention ids (order preserved). */
export function uniqueIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || id.length > 120 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

export interface UnreadInput {
  lastActivityAt: number;
  lastActivityBy: string;
}

/**
 * A thread is unread for a user when somebody *else* posted in it after the user last opened it.
 * Never opened (`readAt` undefined) counts as "before everything". Your own posts never make a
 * thread unread for you.
 */
export function isUnread(thread: UnreadInput, userId: string | null, readAt: number | undefined): boolean {
  if (!userId) return false;
  if (thread.lastActivityBy === userId) return false;
  return readAt === undefined || thread.lastActivityAt > readAt;
}

/* ------------------------------------------------------------------------ mentions */

export interface MentionRef {
  userId: string;
  name: string;
}

export interface BodySegment {
  text: string;
  /** Set when the segment is an `@name` of someone who was actually mentioned. */
  mention?: MentionRef;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

/**
 * Splits a comment body into plain text and `@Name` mention segments. Only people in `mentions`
 * are highlighted; a stray "@someone" stays plain text. Longest names win ("@Ada Lovelace" before
 * "@Ada"), and a mention must end at a word boundary ("@Adam" does not match "Ada").
 */
export function splitMentions(body: string, mentions: readonly MentionRef[]): BodySegment[] {
  if (mentions.length === 0 || !body.includes("@")) return [{ text: body }];
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const out: BodySegment[] = [];
  let plain = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "@" && !isWordChar(body[i - 1])) {
      const hit = names.find((m) => m.name.length > 0 && body.startsWith(m.name, i + 1) && !isWordChar(body[i + 1 + m.name.length]));
      if (hit) {
        if (plain) out.push({ text: plain });
        plain = "";
        out.push({ text: `@${hit.name}`, mention: hit });
        i += 1 + hit.name.length;
        continue;
      }
    }
    plain += body[i];
    i++;
  }
  if (plain) out.push({ text: plain });
  return out;
}

/**
 * Which of `candidates` are really mentioned in `body` as "@Name". Used on submit so deleting the
 * text of a mention from the box also drops it from the notification list.
 */
export function mentionedIn<T extends MentionRef>(body: string, candidates: readonly T[]): T[] {
  const found = new Map<string, T>();
  for (const seg of splitMentions(body, candidates)) {
    if (seg.mention) {
      const c = candidates.find((x) => x.userId === seg.mention!.userId);
      if (c) found.set(c.userId, c);
    }
  }
  return Array.from(found.values());
}

/**
 * The "@query" being typed at the caret, if any: `{ start, query }` where `start` is the index of
 * the "@". Queries may contain spaces (names do) but not a newline, and stop after 30 characters.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (isWordChar(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || query.includes("\n")) return null;
  return { start: at, query };
}

/** Case/diacritic-insensitive prefix-then-substring search, best matches first. */
export function searchPeople<T extends { name: string }>(people: readonly T[], query: string, limit = 6): T[] {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = norm(query.trim());
  if (!q) return people.slice(0, limit);
  const starts: T[] = [];
  const contains: T[] = [];
  for (const p of people) {
    const n = norm(p.name);
    if (n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))) starts.push(p);
    else if (n.includes(q)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, limit);
}
