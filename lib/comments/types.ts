import type { Anchor, MentionRef } from "@/lib/comments/logic";

export type { Anchor, MentionRef };

export interface CommentAuthor {
  userId: string;
  name: string;
  avatar?: string;
}

export type ThreadStatus = "open" | "resolved";

/** One row of the thread list / one pin on the board. */
export interface ThreadSummary {
  id: string;
  anchor: Anchor;
  status: ThreadStatus;
  author: CommentAuthor;
  createdAt: number;
  lastActivityAt: number;
  lastActivityBy: string;
  replyCount: number;
  /** First message, flattened to one line. */
  snippet: string;
  unread: boolean;
  /** Somebody @mentioned the signed-in user in this thread. */
  mentionsMe: boolean;
  resolvedAt?: number;
  resolvedByName?: string;
}

export interface CommentMessage {
  id: string;
  threadId: string;
  author: CommentAuthor;
  body: string;
  mentions: MentionRef[];
  createdAt: number;
  editedAt?: number;
}

export interface MentionCandidate {
  userId: string;
  name: string;
  avatar?: string;
}

export type ThreadFilter = "all" | "open" | "unread" | "resolved";
