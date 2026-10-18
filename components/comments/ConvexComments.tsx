"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cleanError } from "@/lib/comments/errors";
import type { CommentAuthor, CommentMessage, MentionCandidate, ThreadSummary } from "@/lib/comments/types";
import { CommentsProvider, useCommentsViewState, type CommentsApi } from "./context";

interface Props {
  slateId: Id<"slates">;
  me: CommentAuthor | null;
  canComment: boolean;
  canModerate: boolean;
  children: React.ReactNode;
}

/** Comments backed by Convex (`convex/comments.ts`). Access rules are enforced there; this only adapts shapes. */
export function ConvexComments({ slateId, me, canComment, canModerate, children }: Props) {
  const view = useCommentsViewState();
  const rawThreads = useQuery(api.comments.list, { slateId });
  const rawMembers = useQuery(api.comments.members, canComment ? { slateId } : "skip");
  const rawMessages = useQuery(api.comments.messages, view.openThreadId ? { threadId: view.openThreadId as Id<"commentThreads"> } : "skip");

  const createThread = useMutation(api.comments.createThread);
  const reply = useMutation(api.comments.reply);
  const setResolved = useMutation(api.comments.setResolved);
  const editMessage = useMutation(api.comments.editMessage);
  const deleteMessage = useMutation(api.comments.deleteMessage);
  const deleteThread = useMutation(api.comments.deleteThread);
  const markRead = useMutation(api.comments.markRead);
  const markAllRead = useMutation(api.comments.markAllRead);

  const threads = React.useMemo<ThreadSummary[] | undefined>(
    () =>
      rawThreads?.map((t) => ({
        id: t.id,
        anchor: t.anchor,
        status: t.status,
        author: { userId: t.authorId, name: t.authorName, avatar: t.authorAvatar },
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
        lastActivityBy: t.lastActivityBy,
        replyCount: t.replyCount,
        snippet: t.snippet,
        unread: t.unread,
        mentionsMe: t.mentionsMe,
        resolvedAt: t.resolvedAt,
        resolvedByName: t.resolvedByName,
      })),
    [rawThreads]
  );
  const members = React.useMemo<MentionCandidate[]>(() => rawMembers ?? [], [rawMembers]);
  const messages = React.useMemo<CommentMessage[] | undefined>(
    () =>
      rawMessages?.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        author: { userId: m.authorId, name: m.authorName, avatar: m.authorAvatar },
        body: m.body,
        mentions: m.mentions,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
      })),
    [rawMessages]
  );

  const value = React.useMemo<CommentsApi>(() => {
    const run = async <T,>(p: Promise<T>): Promise<T> => {
      try {
        return await p;
      } catch (e) {
        throw new Error(cleanError(e));
      }
    };
    return {
      me,
      canComment,
      canModerate,
      threads,
      members,
      messages,
      createThread: (input) => run(createThread({ slateId, ...input })),
      reply: async (threadId, body, mentions) => void (await run(reply({ threadId: threadId as Id<"commentThreads">, body, mentions }))),
      setResolved: async (threadId, resolved) => void (await run(setResolved({ threadId: threadId as Id<"commentThreads">, resolved }))),
      editMessage: async (messageId, body, mentions) => void (await run(editMessage({ messageId: messageId as Id<"comments">, body, mentions }))),
      deleteMessage: async (messageId) => void (await run(deleteMessage({ messageId: messageId as Id<"comments"> }))),
      deleteThread: async (threadId) => void (await run(deleteThread({ threadId: threadId as Id<"commentThreads"> }))),
      markRead: (threadId) => void markRead({ threadId: threadId as Id<"commentThreads"> }).catch(() => undefined),
      markAllRead: () => void markAllRead({ slateId }).catch(() => undefined),
      ...view,
    };
  }, [me, canComment, canModerate, threads, members, messages, slateId, createThread, reply, setResolved, editMessage, deleteMessage, deleteThread, markRead, markAllRead, view]);

  return <CommentsProvider value={value}>{children}</CommentsProvider>;
}
