"use client";

import * as React from "react";
import type { LocalCommentsStore } from "@/lib/comments/local";
import { CommentsProvider, useCommentsViewState, type CommentsApi } from "./context";

/** Comments for the no-account playground: same UI, data kept in this browser (see lib/comments/local.ts). */
export function LocalComments({ store, children }: { store: LocalCommentsStore; children: React.ReactNode }) {
  const view = useCommentsViewState();
  const version = React.useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

  const value = React.useMemo<CommentsApi>(() => {
    // `version` changes whenever the store does; reading through the store keeps the snapshot fresh
    void version;
    return {
      me: store.me,
      canComment: true,
      canModerate: true,
      threads: store.threads(),
      members: store.people,
      messages: view.openThreadId ? store.messages(view.openThreadId) : undefined,
      createThread: async ({ anchor, body, mentions }) => store.createThread(anchor, body, mentions),
      reply: async (threadId, body, mentions) => store.reply(threadId, body, mentions),
      setResolved: async (threadId, resolved) => store.setResolved(threadId, resolved),
      editMessage: async (messageId, body, mentions) => store.editMessage(messageId, body, mentions),
      deleteMessage: async (messageId) => store.deleteMessage(messageId),
      deleteThread: async (threadId) => store.deleteThread(threadId),
      markRead: (threadId) => store.markRead(threadId),
      markAllRead: () => store.markAllRead(),
      ...view,
    };
  }, [store, version, view]);

  return <CommentsProvider value={value}>{children}</CommentsProvider>;
}
