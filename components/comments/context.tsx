"use client";

import * as React from "react";
import type { Anchor, CommentAuthor, CommentMessage, MentionCandidate, ThreadFilter, ThreadSummary } from "@/lib/comments/types";

/**
 * Everything the comment UI needs, independent of where the data lives: `RemoteComments` backs it
 * with the database, `LocalComments` (the public playground) with the browser's storage. The pins,
 * popover and side panel only ever talk to this interface.
 */
export interface CommentsApi {
  me: CommentAuthor | null;
  /** May start threads, reply and resolve (see the rules in lib/server/access.ts). */
  canComment: boolean;
  /** May also delete other people's comments. */
  canModerate: boolean;
  /** undefined while loading */
  threads: ThreadSummary[] | undefined;
  /** People that can be @mentioned. */
  members: MentionCandidate[];
  /** Messages of `openThreadId`; undefined while loading. */
  messages: CommentMessage[] | undefined;

  createThread(input: { anchor: Anchor; body: string; mentions: string[] }): Promise<string>;
  reply(threadId: string, body: string, mentions: string[]): Promise<void>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  editMessage(messageId: string, body: string, mentions: string[]): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  markRead(threadId: string): void;
  markAllRead(): void;

  /* shared view state */
  openThreadId: string | null;
  openThread(id: string | null): void;
  /** A pin that has been dropped but not posted yet. */
  draft: Anchor | null;
  startDraft(anchor: Anchor | null): void;
  filter: ThreadFilter;
  setFilter(f: ThreadFilter): void;
}

const CommentsContext = React.createContext<CommentsApi | null>(null);

export const CommentsProvider = CommentsContext.Provider;

/** null when the page has no comment backend (the whole feature then stays out of the way). */
export function useComments(): CommentsApi | null {
  return React.useContext(CommentsContext);
}

/** Open thread / unposted pin / panel filter. Opening a thread discards an unposted pin and vice versa. */
export function useCommentsViewState() {
  const [openThreadId, setOpen] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Anchor | null>(null);
  const [filter, setFilter] = React.useState<ThreadFilter>("open");
  const openThread = React.useCallback((id: string | null) => {
    setOpen(id);
    if (id) setDraft(null);
  }, []);
  const startDraft = React.useCallback((anchor: Anchor | null) => {
    setDraft(anchor);
    if (anchor) setOpen(null);
  }, []);
  // memoised so providers can list it as a dependency without re-rendering every consumer each time
  return React.useMemo(() => ({ openThreadId, openThread, draft, startDraft, filter, setFilter }), [openThreadId, openThread, draft, startDraft, filter]);
}
