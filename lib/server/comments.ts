import { z } from "zod";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { CommentDoc, CommentThreadDoc, Id, SlateDoc } from "@/lib/db/types";
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
} from "@/lib/comments/logic";
import { canComment, canModerate, loadSlate, requireComment, resolveAccess } from "./access";
import { AppError, mutation, query, zId, type Ctx } from "./fn";
import { toProfile, slateMembers } from "./profile";
import { takeToken } from "./usage";

/** Posting is bounded per user so a compromised or scripted account can't flood a board. */
const POSTS_PER_MINUTE = 20;
const MAX_THREAD_MENTIONS = 40;

/** Anchors are validated (and clamped) by `sanitizeAnchor`; this only checks the envelope. */
const anchorSchema = z.looseObject({ kind: z.enum(["point", "element"]) });
const bodySchema = z.string().max(20_000);
const mentionIds = z.array(z.string().max(120)).max(200);

async function throttle(userId: string) {
  const t = await takeToken(userId, "comment", POSTS_PER_MINUTE, 60_000);
  if (!t.allowed) throw new AppError(`You're commenting too fast. Try again in ${Math.ceil(t.retryAfterMs / 1000)}s.`);
}

/** Only real members of the board's workspace can be mentioned; names come from the server, never the client. */
async function resolveMentions(slate: SlateDoc, selfId: string, ids: readonly string[]): Promise<MentionRef[]> {
  const wanted = uniqueIds(ids).filter((id) => id !== selfId);
  if (wanted.length === 0) return [];
  const members = await slateMembers(slate);
  const byId = new Map(members.map((m) => [m.userId, m]));
  const out: MentionRef[] = [];
  for (const id of wanted) {
    const m = byId.get(id);
    if (m) out.push({ userId: m.userId, name: m.name });
  }
  return out;
}

/** Public identity (name + avatar) of the signed-in caller. */
async function callerProfile(ctx: Ctx, userId: string) {
  return toProfile(userId, await ctx.profile());
}

async function threadWithSlate(threadId: Id<"commentThreads">) {
  const c = await getCollections();
  const thread = await c.commentThreads.findOne({ _id: threadId });
  if (!thread) return null;
  const slate = await loadSlate(thread.slateId);
  return slate ? { thread, slate } : null;
}

async function messagesOf(threadId: Id<"commentThreads">): Promise<CommentDoc[]> {
  const c = await getCollections();
  return await c.comments.find({ threadId }).sort({ createdAt: 1 }).limit(MAX_MESSAGES_PER_THREAD + 1).toArray();
}

/* ---------------------------------------------------------------------- reads */

/**
 * Thread summaries for the pins and the side panel (newest activity first). Empty, never an error,
 * when access is missing or revoked mid-session.
 */
export const list = query({
  args: z.object({ slateId: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.slateId);
    if (!slate) return [];
    const access = await resolveAccess(ctx, slate);
    if (!access) return [];
    const userId = access.userId;
    const c = await getCollections();

    const threads = await c.commentThreads.find({ slateId: args.slateId }).sort({ lastActivityAt: -1 }).limit(LIST_LIMIT).toArray();
    const readAt = new Map<string, number>();
    if (userId) {
      const reads = await c.commentReads.find({ slateId: args.slateId, userId }).limit(1000).toArray();
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
  args: z.object({ threadId: zId }),
  handler: async (ctx, args) => {
    const found = await threadWithSlate(args.threadId);
    if (!found || !(await resolveAccess(ctx, found.slate))) return [];
    const rows = await messagesOf(args.threadId);
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
  args: z.object({ slateId: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.slateId);
    if (!slate) return [];
    const access = await resolveAccess(ctx, slate);
    if (!access || !canComment(access)) return [];
    return (await slateMembers(slate)).filter((m) => m.userId !== access.userId);
  },
});

/* --------------------------------------------------------------------- writes */

export const createThread = mutation({
  args: z.object({ slateId: zId, anchor: anchorSchema, body: bodySchema, mentions: mentionIds }),
  handler: async (ctx, args) => {
    const { slate, access } = await requireComment(ctx, args.slateId);
    const anchor = sanitizeAnchor(args.anchor);
    if (!anchor) throw new AppError("That position can't hold a comment");
    const body = cleanBody(args.body);
    if (!body) throw new AppError("Write a comment first");
    await throttle(access.userId);

    const c = await getCollections();
    if ((await c.commentThreads.countDocuments({ slateId: args.slateId }, { limit: MAX_THREADS_PER_SLATE })) >= MAX_THREADS_PER_SLATE) {
      throw new AppError(`This board already has ${MAX_THREADS_PER_SLATE} comment threads. Delete some resolved ones to add more.`);
    }

    const me = await callerProfile(ctx, access.userId);
    const mentions = await resolveMentions(slate, access.userId, args.mentions);
    const now = Date.now();
    const threadId = newDocId();
    await c.commentThreads.insertOne({
      _id: threadId,
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
    await c.comments.insertOne({
      _id: newDocId(),
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
  args: z.object({ threadId: zId, body: bodySchema, mentions: mentionIds }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const thread = await c.commentThreads.findOne({ _id: args.threadId });
    if (!thread) throw new AppError("This thread was deleted");
    const { slate, access } = await requireComment(ctx, thread.slateId);
    const body = cleanBody(args.body);
    if (!body) throw new AppError("Write a reply first");
    if (thread.replyCount + 1 >= MAX_MESSAGES_PER_THREAD) throw new AppError("This thread is full. Start a new one.");
    await throttle(access.userId);

    const me = await callerProfile(ctx, access.userId);
    const mentions = await resolveMentions(slate, access.userId, args.mentions);
    const now = Date.now();
    await c.comments.insertOne({
      _id: newDocId(),
      threadId: args.threadId,
      slateId: thread.slateId,
      authorId: me.userId,
      authorName: me.name,
      authorAvatar: me.avatar,
      body,
      mentions,
      createdAt: now,
    });
    await c.commentThreads.updateOne(
      { _id: args.threadId },
      {
        $set: {
          replyCount: thread.replyCount + 1,
          lastActivityAt: now,
          lastActivityBy: me.userId,
          mentionedIds: uniqueIds([...thread.mentionedIds, ...mentions.map((m) => m.userId)]).slice(0, MAX_THREAD_MENTIONS),
          // answering a resolved thread brings it back, otherwise the reply would be easy to miss
          ...(thread.status === "resolved" ? { status: "open" as const } : {}),
        },
        ...(thread.status === "resolved" ? { $unset: { resolvedAt: "", resolvedByName: "" } } : {}),
      }
    );
  },
});

/** Resolve / reopen a thread. Anyone who may comment may do it. */
export const setResolved = mutation({
  args: z.object({ threadId: zId, resolved: z.boolean() }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const thread = await c.commentThreads.findOne({ _id: args.threadId });
    if (!thread) throw new AppError("This thread was deleted");
    const { access } = await requireComment(ctx, thread.slateId);
    if ((thread.status === "resolved") === args.resolved) return;
    if (args.resolved) {
      const me = await callerProfile(ctx, access.userId);
      await c.commentThreads.updateOne({ _id: args.threadId }, { $set: { status: "resolved", resolvedAt: Date.now(), resolvedByName: me.name } });
    } else {
      await c.commentThreads.updateOne({ _id: args.threadId }, { $set: { status: "open" }, $unset: { resolvedAt: "", resolvedByName: "" } });
    }
  },
});

/** Authors can edit their own messages. */
export const editMessage = mutation({
  args: z.object({ messageId: zId, body: bodySchema, mentions: mentionIds }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const msg = await c.comments.findOne({ _id: args.messageId });
    if (!msg) throw new AppError("This comment was deleted");
    const { slate, access } = await requireComment(ctx, msg.slateId);
    if (msg.authorId !== access.userId) throw new AppError("You can only edit your own comments");
    const body = cleanBody(args.body);
    if (!body) throw new AppError("A comment can't be empty. Delete it instead.");
    const mentions = await resolveMentions(slate, access.userId, args.mentions);
    await c.comments.updateOne({ _id: args.messageId }, { $set: { body, mentions, editedAt: Date.now() } });

    const all = (await messagesOf(msg.threadId)).map((m) => (m._id === args.messageId ? { ...m, body, mentions } : m));
    const thread: CommentThreadDoc | null = await c.commentThreads.findOne({ _id: msg.threadId });
    if (thread) {
      await c.commentThreads.updateOne(
        { _id: msg.threadId },
        {
          $set: {
            mentionedIds: uniqueIds(all.flatMap((m) => m.mentions.map((x) => x.userId))).slice(0, MAX_THREAD_MENTIONS),
            ...(all[0]?._id === args.messageId ? { snippet: snippetOf(body) } : {}),
          },
        }
      );
    }
  },
});

/** Deletes one reply (its author or a moderator). The opening message goes with `deleteThread`. */
export const deleteMessage = mutation({
  args: z.object({ messageId: zId }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const msg = await c.comments.findOne({ _id: args.messageId });
    if (!msg) return;
    const { access } = await requireComment(ctx, msg.slateId);
    if (msg.authorId !== access.userId && !canModerate(access)) throw new AppError("You can only delete your own comments");
    const all = await messagesOf(msg.threadId);
    if (all[0]?._id === args.messageId) throw new AppError("Delete the whole thread instead");
    await c.comments.deleteOne({ _id: args.messageId });
    const thread = await c.commentThreads.findOne({ _id: msg.threadId });
    if (thread) {
      const rest = all.filter((m) => m._id !== args.messageId);
      await c.commentThreads.updateOne(
        { _id: msg.threadId },
        {
          $set: {
            replyCount: Math.max(0, rest.length - 1),
            mentionedIds: uniqueIds(rest.flatMap((m) => m.mentions.map((x) => x.userId))).slice(0, MAX_THREAD_MENTIONS),
          },
        }
      );
    }
  },
});

/** Removes a thread with all its replies and read markers (its starter or a moderator). */
export const deleteThread = mutation({
  args: z.object({ threadId: zId }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const thread = await c.commentThreads.findOne({ _id: args.threadId });
    if (!thread) return;
    const { access } = await requireComment(ctx, thread.slateId);
    if (thread.authorId !== access.userId && !canModerate(access)) throw new AppError("You can only delete threads you started");
    await c.comments.deleteMany({ threadId: args.threadId });
    await c.commentReads.deleteMany({ threadId: args.threadId });
    await c.commentThreads.deleteOne({ _id: args.threadId });
  },
});

/* ---------------------------------------------------------------- read markers */

async function markThreadRead(thread: CommentThreadDoc, userId: string) {
  const c = await getCollections();
  const readAt = Math.max(Date.now(), thread.lastActivityAt);
  // never moves a marker backwards, and creates it on first read
  await c.commentReads.updateOne(
    { threadId: thread._id, userId },
    { $max: { readAt }, $setOnInsert: { _id: newDocId(), slateId: thread.slateId } },
    { upsert: true }
  );
}

/** Marks one thread as seen by the caller. Quietly does nothing for anonymous visitors. */
export const markRead = mutation({
  args: z.object({ threadId: zId }),
  handler: async (ctx, args) => {
    const c = await getCollections();
    const thread = await c.commentThreads.findOne({ _id: args.threadId });
    if (!thread) return;
    const slate = await loadSlate(thread.slateId);
    const access = slate ? await resolveAccess(ctx, slate) : null;
    if (!access?.userId) return;
    await markThreadRead(thread, access.userId);
  },
});

export const markAllRead = mutation({
  args: z.object({ slateId: zId }),
  handler: async (ctx, args) => {
    const slate = await loadSlate(args.slateId);
    const access = slate ? await resolveAccess(ctx, slate) : null;
    if (!access?.userId) return;
    const c = await getCollections();
    const threads = await c.commentThreads.find({ slateId: args.slateId }).sort({ lastActivityAt: -1 }).limit(LIST_LIMIT).toArray();
    for (const t of threads) await markThreadRead(t, access.userId);
  },
});
