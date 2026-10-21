import {
  cleanBody,
  isUnread,
  MAX_MESSAGES_PER_THREAD,
  MAX_THREADS_PER_SLATE,
  sanitizeAnchor,
  snippetOf,
  uniqueIds,
  type MentionRef,
} from "@/lib/comments/logic";
import { newId } from "@/lib/canvas/ids";
import type { El } from "@/lib/canvas/types";
import { anchorAt } from "./anchor";
import type { Anchor, CommentAuthor, CommentMessage, MentionCandidate, ThreadStatus, ThreadSummary } from "./types";

interface StoredThread {
  id: string;
  anchor: Anchor;
  status: ThreadStatus;
  author: CommentAuthor;
  createdAt: number;
  lastActivityAt: number;
  lastActivityBy: string;
  replyCount: number;
  snippet: string;
  mentionedIds: string[];
  resolvedAt?: number;
  resolvedByName?: string;
}

interface StoredMessage extends Omit<CommentMessage, "author"> {
  author: CommentAuthor;
}

interface Stored {
  threads: StoredThread[];
  messages: StoredMessage[];
  /** threadId -> when the signed-in user last opened it */
  reads: Record<string, number>;
}

/**
 * The public playground has no backend, so comments live in this browser: the same rules as
 * `lib/server/comments.ts` (it shares `commentLogic.ts`), kept in localStorage. "Teammates" are sample
 * people so @mentions, unread badges and the filters can be tried without an account.
 */
export class LocalCommentsStore {
  private data: Stored = { threads: [], messages: [], reads: {} };
  private listeners = new Set<() => void>();
  private version = 0;
  private cache: { version: number; threads: ThreadSummary[] } | null = null;

  constructor(
    private key: string,
    readonly me: CommentAuthor,
    readonly people: MentionCandidate[]
  ) {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Stored>;
        if (Array.isArray(parsed.threads) && Array.isArray(parsed.messages)) {
          this.data = { threads: parsed.threads, messages: parsed.messages, reads: parsed.reads && typeof parsed.reads === "object" ? parsed.reads : {} };
        }
      }
    } catch {
      /* corrupt storage: start empty */
    }
  }

  /* -------------------------------------------------------------- subscription */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private changed() {
    this.version++;
    this.cache = null;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* storage full or unavailable: comments still work for this session */
    }
    for (const fn of this.listeners) fn();
  }

  /* --------------------------------------------------------------------- reads */

  get isEmpty() {
    return this.data.threads.length === 0;
  }

  threads(): ThreadSummary[] {
    if (this.cache?.version === this.version) return this.cache.threads;
    const threads = [...this.data.threads]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map<ThreadSummary>((t) => ({
        id: t.id,
        anchor: t.anchor,
        status: t.status,
        author: t.author,
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
        lastActivityBy: t.lastActivityBy,
        replyCount: t.replyCount,
        snippet: t.snippet,
        unread: isUnread(t, this.me.userId, this.data.reads[t.id]),
        mentionsMe: t.mentionedIds.includes(this.me.userId),
        resolvedAt: t.resolvedAt,
        resolvedByName: t.resolvedByName,
      }));
    this.cache = { version: this.version, threads };
    return threads;
  }

  messages(threadId: string): CommentMessage[] {
    return this.data.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);
  }

  /* -------------------------------------------------------------------- writes */

  private mentionsFor(ids: readonly string[]): MentionRef[] {
    const wanted = uniqueIds(ids).filter((id) => id !== this.me.userId);
    return wanted.flatMap((id) => {
      const p = this.people.find((x) => x.userId === id);
      return p ? [{ userId: p.userId, name: p.name }] : [];
    });
  }

  private post(threadId: string, author: CommentAuthor, body: string, mentions: MentionRef[], at: number) {
    this.data.messages.push({ id: newId("m"), threadId, author, body, mentions, createdAt: at });
  }

  createThread(anchorIn: Anchor, bodyIn: string, mentionIds: string[]): string {
    const anchor = sanitizeAnchor(anchorIn);
    if (!anchor) throw new Error("That position can't hold a comment");
    const body = cleanBody(bodyIn);
    if (!body) throw new Error("Write a comment first");
    if (this.data.threads.length >= MAX_THREADS_PER_SLATE) throw new Error(`This board already has ${MAX_THREADS_PER_SLATE} comment threads. Delete some resolved ones to add more.`);
    const mentions = this.mentionsFor(mentionIds);
    const now = Date.now();
    const id = newId("t");
    this.data.threads.push({
      id,
      anchor,
      status: "open",
      author: this.me,
      createdAt: now,
      lastActivityAt: now,
      lastActivityBy: this.me.userId,
      replyCount: 0,
      snippet: snippetOf(body),
      mentionedIds: mentions.map((m) => m.userId),
    });
    this.post(id, this.me, body, mentions, now);
    this.changed();
    return id;
  }

  reply(threadId: string, bodyIn: string, mentionIds: string[]) {
    const t = this.data.threads.find((x) => x.id === threadId);
    if (!t) throw new Error("This thread was deleted");
    const body = cleanBody(bodyIn);
    if (!body) throw new Error("Write a reply first");
    if (t.replyCount + 1 >= MAX_MESSAGES_PER_THREAD) throw new Error("This thread is full. Start a new one.");
    const mentions = this.mentionsFor(mentionIds);
    const now = Date.now();
    this.post(threadId, this.me, body, mentions, now);
    t.replyCount++;
    t.lastActivityAt = now;
    t.lastActivityBy = this.me.userId;
    t.mentionedIds = uniqueIds([...t.mentionedIds, ...mentions.map((m) => m.userId)]).slice(0, 40);
    if (t.status === "resolved") {
      t.status = "open";
      t.resolvedAt = undefined;
      t.resolvedByName = undefined;
    }
    this.changed();
  }

  setResolved(threadId: string, resolved: boolean) {
    const t = this.data.threads.find((x) => x.id === threadId);
    if (!t) throw new Error("This thread was deleted");
    if ((t.status === "resolved") === resolved) return;
    t.status = resolved ? "resolved" : "open";
    t.resolvedAt = resolved ? Date.now() : undefined;
    t.resolvedByName = resolved ? this.me.name : undefined;
    this.changed();
  }

  editMessage(messageId: string, bodyIn: string, mentionIds: string[]) {
    const m = this.data.messages.find((x) => x.id === messageId);
    if (!m) throw new Error("This comment was deleted");
    if (m.author.userId !== this.me.userId) throw new Error("You can only edit your own comments");
    const body = cleanBody(bodyIn);
    if (!body) throw new Error("A comment can't be empty. Delete it instead.");
    m.body = body;
    m.mentions = this.mentionsFor(mentionIds);
    m.editedAt = Date.now();
    const t = this.data.threads.find((x) => x.id === m.threadId);
    if (t) {
      const all = this.messages(t.id);
      t.mentionedIds = uniqueIds(all.flatMap((x) => x.mentions.map((y) => y.userId))).slice(0, 40);
      if (all[0]?.id === m.id) t.snippet = snippetOf(body);
    }
    this.changed();
  }

  deleteMessage(messageId: string) {
    const m = this.data.messages.find((x) => x.id === messageId);
    if (!m) return;
    const all = this.messages(m.threadId);
    if (all[0]?.id === messageId) throw new Error("Delete the whole thread instead");
    this.data.messages = this.data.messages.filter((x) => x.id !== messageId);
    const t = this.data.threads.find((x) => x.id === m.threadId);
    if (t) t.replyCount = Math.max(0, t.replyCount - 1);
    this.changed();
  }

  deleteThread(threadId: string) {
    this.data.threads = this.data.threads.filter((t) => t.id !== threadId);
    this.data.messages = this.data.messages.filter((m) => m.threadId !== threadId);
    delete this.data.reads[threadId];
    this.changed();
  }

  markRead(threadId: string) {
    const t = this.data.threads.find((x) => x.id === threadId);
    if (!t) return;
    const prev = this.data.reads[threadId];
    if (prev !== undefined && prev >= t.lastActivityAt) return;
    this.data.reads[threadId] = Math.max(Date.now(), t.lastActivityAt);
    this.changed();
  }

  markAllRead() {
    let any = false;
    for (const t of this.data.threads) {
      const prev = this.data.reads[t.id];
      if (prev === undefined || prev < t.lastActivityAt) {
        this.data.reads[t.id] = Math.max(Date.now(), t.lastActivityAt);
        any = true;
      }
    }
    if (any) this.changed();
  }

  /**
   * First visit: a few threads from sample teammates so the feature can be tried straight away.
   * `anchorTitle` picks the element a thread follows, by card/sticky title.
   */
  seedSample(elements: readonly El[]) {
    if (!this.isEmpty) return;
    const [priya, marcus] = this.people;
    if (!priya || !marcus) return;
    const find = (title: string) => elements.find((e) => (e.type === "card" && e.title === title) || (e.type === "sticky" && e.text.startsWith(title)));
    const api = find("API gateway");
    const db = find("PostgreSQL");
    const now = Date.now();
    const add = (author: CommentAuthor, anchor: Anchor, body: string, ageMs: number, mentions: MentionRef[] = [], opts: { resolved?: boolean; replies?: { author: CommentAuthor; body: string; ageMs: number }[] } = {}) => {
      const at = now - ageMs;
      const id = newId("t");
      const replies = opts.replies ?? [];
      const last = replies.length ? now - replies[replies.length - 1].ageMs : at;
      this.data.threads.push({
        id,
        anchor,
        status: opts.resolved ? "resolved" : "open",
        author,
        createdAt: at,
        lastActivityAt: last,
        lastActivityBy: replies.length ? replies[replies.length - 1].author.userId : author.userId,
        replyCount: replies.length,
        snippet: snippetOf(body),
        mentionedIds: mentions.map((m) => m.userId),
        ...(opts.resolved ? { resolvedAt: last, resolvedByName: author.name } : {}),
      });
      this.post(id, author, body, mentions, at);
      for (const r of replies) this.post(id, r.author, r.body, [], now - r.ageMs);
    };
    const asAuthor = (p: MentionCandidate): CommentAuthor => ({ userId: p.userId, name: p.name, avatar: p.avatar });
    const meRef: MentionRef = { userId: this.me.userId, name: this.me.name };
    add(
      asAuthor(priya),
      api ? anchorAt({ x: api.x + api.w * 0.9, y: api.y + api.h * 0.15 }, api) : { kind: "point", x: 300, y: 20 },
      `@${this.me.name} should rate limiting live here or at the edge proxy? I'd keep it at the gateway so every service gets it for free.`,
      42 * 60_000,
      [meRef]
    );
    add(
      asAuthor(marcus),
      db ? anchorAt({ x: db.x + db.w * 0.5, y: db.y + db.h * 0.1 }, db) : { kind: "point", x: 1100, y: -60 },
      "Do we need a read replica before launch? Checkout traffic will spike.",
      26 * 3_600_000,
      [],
      { replies: [{ author: asAuthor(priya), body: "Yes. Added to the launch checklist.", ageMs: 20 * 3_600_000 }] }
    );
    add(asAuthor(priya), { kind: "point", x: 560, y: 360 }, "Nit: this sticky note can go once the diagram is final.", 3 * 86_400_000, [], { resolved: true });
    // the resolved one counts as seen; the other two start unread
    this.data.reads = Object.fromEntries(this.data.threads.filter((t) => t.status === "resolved").map((t) => [t.id, now]));
    this.changed();
  }
}
