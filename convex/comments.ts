import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canComment, canModerate, loadSlate, requireComment, resolveAccess } from "./access";
import {
  cleanBody,
  isUnread,
  LIST_LIMIT,
  MAX_MESSAGES_PER_THREAD,
  MAX_THREADS_PER_SLATE,
  sanitizeAnchor,
  snippetOf,
  uniqueIds,
  type MentionRef,
} from "./commentLogic";
import { profileOf, slateMembers } from "./profile";
import { anchorValidator } from "./schema";
import { takeToken } from "./usage";

/** Posting is bounded per user so a compromised or scripted account can't flood a board. */
const POSTS_PER_MINUTE = 20;
const MAX_THREAD_MENTIONS = 40;

async function throttle(ctx: MutationCtx, userId: string) {
  const t = await takeToken(ctx, userId, "comment", POSTS_PER_MINUTE, 60_000);
  if (!t.allowed) throw new Error(`You're commenting too fast. Try again in ${Math.ceil(t.retryAfterMs / 1000)}s.`);
}

/** Only real members of the board's workspace can be mentioned; names come from the server, never the client. */
async function resolveMentions(ctx: QueryCtx, slate: Doc<"slates">, selfId: string, ids: readonly string[]): Promise<MentionRef[]> {
  const wanted = uniqueIds(ids).filter((id) => id !== selfId);
  if (wanted.length === 0) return [];
  const members = await slateMembers(ctx, slate);
  const byId = new Map(members.map((m) => [m.userId, m]));
  const out: MentionRef[] = [];
  for (const id of wanted) {
    const m = byId.get(id);
    if (m) out.push({ userId: m.userId, name: m.name });
  }
  return out;
}

/** Public identity (name + avatar) of the signed-in caller. */
async function callerProfile(ctx: QueryCtx, userId: string) {
  const identity = await ctx.auth.getUserIdentity();
  return await profileOf(ctx, userId, identity?.name, identity?.pictureUrl);
}

async function threadWithSlate(ctx: QueryCtx, threadId: Id<"commentThreads">) {
  const thread = await ctx.db.get(threadId);
  if (!thread) return null;
  const slate = await loadSlate(ctx, thread.slateId);
  return slate ? { thread, slate } : null;
}

async function messagesOf(ctx: QueryCtx, threadId: Id<"commentThreads">) {
  return await ctx.db
    .query("comments")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .take(MAX_MESSAGES_PER_THREAD + 1);
}

/* ---------------------------------------------------------------------- reads */

/**
 * Thread summaries for the pins and the side panel (newest activity first). Empty, never an error,
 * when access is missing or revoked mid-session.
 */
export const list = query({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await loadSlate(ctx, args.slateId);
    if (!slate) return [];
    const access = await resolveAccess(ctx, slate);
    if (!access) return [];
    const userId = access.userId;

    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_slate_activity", (q) => q.eq("slateId", args.slateId))
      .order("desc")
      .take(LIST_LIMIT);
    const readAt = new Map<string, number>();
    if (userId) {
      const reads = await ctx.db
        .query("commentReads")
        .withIndex("by_slate_user", (q) => q.eq("slateId", args.slateId).eq("userId", userId))
        .take(1000);
      for (const r of reads) readAt.set(r.threadId, r.readAt);
    }
    return threads.map((t) => ({
      id: t._id,
      anchor: t.anchor,
      status: t.status,
      authorId: t.authorId,
      authorName: t.authorName,
      authorAvatar: t.authorAvatar,
      createdAt: t.createdAt,
      lastActivityAt: t.lastActivityAt,
      lastActivityBy: t.lastActivityBy,
      replyCount: t.replyCount,
      snippet: t.snippet,
      unread: isUnread(t, userId, readAt.get(t._id)),
      mentionsMe: !!userId && t.mentionedIds.includes(userId),
      resolvedAt: t.resolvedAt,
      resolvedByName: t.resolvedByName,
    }));
  },
});

/** Every message of one thread, oldest first. */
export const messages = query({
  args: { threadId: v.id("commentThreads") },
  handler: async (ctx, args) => {
    const found = await threadWithSlate(ctx, args.threadId);
    if (!found || !(await resolveAccess(ctx, found.slate))) return [];
    const rows = await messagesOf(ctx, args.threadId);
    return rows.slice(0, MAX_MESSAGES_PER_THREAD).map((m) => ({
      id: m._id,
      threadId: m.threadId,
      authorId: m.authorId,
      authorName: m.authorName,
      authorAvatar: m.authorAvatar,
      body: m.body,
      mentions: m.mentions,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
    }));
  },
});

/** People who can be @mentioned (name and avatar only, never emails). Only offered to people who can comment. */
export const members = query({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await loadSlate(ctx, args.slateId);
    if (!slate) return [];
    const access = await resolveAccess(ctx, slate);
    if (!access || !canComment(access)) return [];
    return (await slateMembers(ctx, slate)).filter((m) => m.userId !== access.userId);
  },
});

/* --------------------------------------------------------------------- writes */

export const createThread = mutation({
  args: { slateId: v.id("slates"), anchor: anchorValidator, body: v.string(), mentions: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { slate, access } = await requireComment(ctx, args.slateId);
    const anchor = sanitizeAnchor(args.anchor);
    if (!anchor) throw new Error("That position can't hold a comment");
    const body = cleanBody(args.body);
    if (!body) throw new Error("Write a comment first");
    await throttle(ctx, access.userId);

    const existing = await ctx.db
      .query("commentThreads")
      .withIndex("by_slate_activity", (q) => q.eq("slateId", args.slateId))
      .take(MAX_THREADS_PER_SLATE);
    if (existing.length >= MAX_THREADS_PER_SLATE) {
      throw new Error(`This board already has ${MAX_THREADS_PER_SLATE} comment threads. Delete some resolved ones to add more.`);
    }

    const me = await callerProfile(ctx, access.userId);
    const mentions = await resolveMentions(ctx, slate, access.userId, args.mentions);
    const now = Date.now();
    const threadId = await ctx.db.insert("commentThreads", {
      slateId: args.slateId,
      anchor,
      status: "open",
      authorId: me.userId,
      authorName: me.name,
      authorAvatar: me.avatar,
      createdAt: now,
      lastActivityAt: now,
      lastActivityBy: me.userId,
      replyCount: 0,
      snippet: snippetOf(body),
      mentionedIds: mentions.map((m) => m.userId),
    });
    await ctx.db.insert("comments", {
      threadId,
      slateId: args.slateId,
      authorId: me.userId,
      authorName: me.name,
      authorAvatar: me.avatar,
      body,
      mentions,
      createdAt: now,
    });
    return threadId;
  },
});

export const reply = mutation({
  args: { threadId: v.id("commentThreads"), body: v.string(), mentions: v.array(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("This thread was deleted");
    const { slate, access } = await requireComment(ctx, thread.slateId);
    const body = cleanBody(args.body);
    if (!body) throw new Error("Write a reply first");
    if (thread.replyCount + 1 >= MAX_MESSAGES_PER_THREAD) throw new Error("This thread is full. Start a new one.");
    await throttle(ctx, access.userId);

    const me = await callerProfile(ctx, access.userId);
    const mentions = await resolveMentions(ctx, slate, access.userId, args.mentions);
    const now = Date.now();
    await ctx.db.insert("comments", {
      threadId: args.threadId,
      slateId: thread.slateId,
      authorId: me.userId,
      authorName: me.name,
      authorAvatar: me.avatar,
      body,
      mentions,
      createdAt: now,
    });
    await ctx.db.patch(args.threadId, {
      replyCount: thread.replyCount + 1,
      lastActivityAt: now,
      lastActivityBy: me.userId,
      mentionedIds: uniqueIds([...thread.mentionedIds, ...mentions.map((m) => m.userId)]).slice(0, MAX_THREAD_MENTIONS),
      // answering a resolved thread brings it back, otherwise the reply would be easy to miss
      ...(thread.status === "resolved" ? { status: "open" as const, resolvedAt: undefined, resolvedByName: undefined } : {}),
    });
  },
});

/** Resolve / reopen a thread. Anyone who may comment may do it. */
export const setResolved = mutation({
  args: { threadId: v.id("commentThreads"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("This thread was deleted");
    const { access } = await requireComment(ctx, thread.slateId);
    if ((thread.status === "resolved") === args.resolved) return;
    if (args.resolved) {
      const me = await callerProfile(ctx, access.userId);
      await ctx.db.patch(args.threadId, { status: "resolved", resolvedAt: Date.now(), resolvedByName: me.name });
    } else {
      await ctx.db.patch(args.threadId, { status: "open", resolvedAt: undefined, resolvedByName: undefined });
    }
  },
});

/** Authors can edit their own messages. */
export const editMessage = mutation({
  args: { messageId: v.id("comments"), body: v.string(), mentions: v.array(v.string()) },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) throw new Error("This comment was deleted");
    const { slate, access } = await requireComment(ctx, msg.slateId);
    if (msg.authorId !== access.userId) throw new Error("You can only edit your own comments");
    const body = cleanBody(args.body);
    if (!body) throw new Error("A comment can't be empty. Delete it instead.");
    const mentions = await resolveMentions(ctx, slate, access.userId, args.mentions);
    await ctx.db.patch(args.messageId, { body, mentions, editedAt: Date.now() });

    const all = (await messagesOf(ctx, msg.threadId)).map((m) => (m._id === args.messageId ? { ...m, body, mentions } : m));
    const thread = await ctx.db.get(msg.threadId);
    if (thread) {
      await ctx.db.patch(msg.threadId, {
        mentionedIds: uniqueIds(all.flatMap((m) => m.mentions.map((x) => x.userId))).slice(0, MAX_THREAD_MENTIONS),
        ...(all[0]?._id === args.messageId ? { snippet: snippetOf(body) } : {}),
      });
    }
  },
});

/** Deletes one reply (its author or a moderator). The opening message goes with `deleteThread`. */
export const deleteMessage = mutation({
  args: { messageId: v.id("comments") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return;
    const { access } = await requireComment(ctx, msg.slateId);
    if (msg.authorId !== access.userId && !canModerate(access)) throw new Error("You can only delete your own comments");
    const all = await messagesOf(ctx, msg.threadId);
    if (all[0]?._id === args.messageId) throw new Error("Delete the whole thread instead");
    await ctx.db.delete(args.messageId);
    const thread = await ctx.db.get(msg.threadId);
    if (thread) {
      const rest = all.filter((m) => m._id !== args.messageId);
      await ctx.db.patch(msg.threadId, {
        replyCount: Math.max(0, rest.length - 1),
        mentionedIds: uniqueIds(rest.flatMap((m) => m.mentions.map((x) => x.userId))).slice(0, MAX_THREAD_MENTIONS),
      });
    }
  },
});

/** Removes a thread with all its replies and read markers (its starter or a moderator). */
export const deleteThread = mutation({
  args: { threadId: v.id("commentThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return;
    const { access } = await requireComment(ctx, thread.slateId);
    if (thread.authorId !== access.userId && !canModerate(access)) throw new Error("You can only delete threads you started");
    for (const m of await messagesOf(ctx, args.threadId)) await ctx.db.delete(m._id);
    const reads = await ctx.db
      .query("commentReads")
      .withIndex("by_thread_user", (q) => q.eq("threadId", args.threadId))
      .take(1000);
    for (const r of reads) await ctx.db.delete(r._id);
    await ctx.db.delete(args.threadId);
  },
});

/* ---------------------------------------------------------------- read markers */

async function markThreadRead(ctx: MutationCtx, thread: Doc<"commentThreads">, userId: string) {
  const row = await ctx.db
    .query("commentReads")
    .withIndex("by_thread_user", (q) => q.eq("threadId", thread._id).eq("userId", userId))
    .unique();
  const readAt = Math.max(Date.now(), thread.lastActivityAt);
  if (!row) await ctx.db.insert("commentReads", { slateId: thread.slateId, threadId: thread._id, userId, readAt });
  else if (row.readAt < thread.lastActivityAt) await ctx.db.patch(row._id, { readAt });
}

/** Marks one thread as seen by the caller. Quietly does nothing for anonymous visitors. */
export const markRead = mutation({
  args: { threadId: v.id("commentThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return;
    const slate = await loadSlate(ctx, thread.slateId);
    const access = slate ? await resolveAccess(ctx, slate) : null;
    if (!access?.userId) return;
    await markThreadRead(ctx, thread, access.userId);
  },
});

export const markAllRead = mutation({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    const slate = await loadSlate(ctx, args.slateId);
    const access = slate ? await resolveAccess(ctx, slate) : null;
    if (!access?.userId) return;
    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_slate_activity", (q) => q.eq("slateId", args.slateId))
      .order("desc")
      .take(LIST_LIMIT);
    for (const t of threads) await markThreadRead(ctx, t, access.userId);
  },
});
