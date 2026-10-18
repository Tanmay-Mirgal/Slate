"use client";

import * as React from "react";
import { Check, CornerUpLeft, Loader2, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { splitMentions } from "@/convex/commentLogic";
import { timeAgo } from "@/lib/comments/format";
import type { CommentMessage, ThreadSummary } from "@/lib/comments/types";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { useComments } from "./context";

function Body({ message, meId }: { message: CommentMessage; meId?: string }) {
  const segs = React.useMemo(() => splitMentions(message.body, message.mentions), [message.body, message.mentions]);
  return (
    <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-zinc-200">
      {segs.map((s, i) =>
        s.mention ? (
          <span key={i} className={`rounded px-0.5 font-medium ${s.mention.userId === meId ? "bg-amber-400/20 text-amber-200" : "bg-indigo-500/20 text-indigo-200"}`}>
            {s.text}
          </span>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        )
      )}
    </p>
  );
}

function MessageRow({ message, isFirst }: { message: CommentMessage; isFirst: boolean }) {
  const c = useComments()!;
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mine = c.me?.userId === message.author.userId;
  const canDelete = !isFirst && (mine || c.canModerate);

  return (
    <li className="group flex gap-2.5 px-3.5 py-2.5">
      <Avatar userId={message.author.userId} name={message.author.name} src={message.author.avatar} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-zinc-100">{message.author.name}</span>
          <time className="shrink-0 text-[11px] text-zinc-500" dateTime={new Date(message.createdAt).toISOString()} title={new Date(message.createdAt).toLocaleString()}>
            {timeAgo(message.createdAt)}
          </time>
          {message.editedAt && <span className="text-[10.5px] text-zinc-600">(edited)</span>}
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {mine && (
              <button type="button" aria-label="Edit comment" title="Edit" onClick={() => setEditing(true)} className="rounded-md p-1 text-zinc-500 hover:bg-white/10 hover:text-white">
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                aria-label="Delete reply"
                title="Delete"
                onClick={() => {
                  setError(null);
                  c.deleteMessage(message.id).catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't delete"));
                }}
                className="rounded-md p-1 text-zinc-500 hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        </div>
        {editing ? (
          <div className="mt-1.5">
            <Composer
              members={c.members}
              initial={message.body}
              submitLabel="Save"
              autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={async (body, ids) => {
                await c.editMessage(message.id, body, ids);
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <Body message={message} meId={c.me?.userId} />
        )}
        {error && <p className="mt-1 text-[11.5px] text-red-400">{error}</p>}
      </div>
    </li>
  );
}

/** A whole thread: messages, resolve / delete, and a reply box. Shown in the popover next to the pin. */
export function ThreadCard({ thread, onClose }: { thread: ThreadSummary; onClose: () => void }) {
  const c = useComments()!;
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [menu, setMenu] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messages = c.messages;
  const mine = c.me?.userId === thread.author.userId;
  const resolved = thread.status === "resolved";

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, thread.id]);

  const toggleResolved = () => {
    setError(null);
    c.setResolved(thread.id, !resolved).catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't update the thread"));
  };

  return (
    <div className="flex max-h-[min(460px,70vh)] w-[330px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141416]/98 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl" role="dialog" aria-label={`Comment thread by ${thread.author.name}`}>
      <div className="flex items-center gap-1 border-b border-white/10 px-2.5 py-2">
        {resolved ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            <Check className="h-3 w-3" /> Resolved{thread.resolvedByName ? ` by ${thread.resolvedByName}` : ""}
          </span>
        ) : (
          <span className="px-1 text-[12px] font-semibold text-zinc-300">Thread</span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          {c.canComment && (
            <button
              type="button"
              onClick={toggleResolved}
              title={resolved ? "Reopen thread" : "Resolve thread"}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              {resolved ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {resolved ? "Reopen" : "Resolve"}
            </button>
          )}
          {c.canComment && (mine || c.canModerate) && (
            <span className="relative">
              <button type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menu && (
                <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-xl border border-white/10 bg-[#1b1b1f] p-1 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      if (window.confirm("Delete this thread and all its replies?")) {
                        c.deleteThread(thread.id)
                          .then(onClose)
                          .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't delete the thread"));
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete thread
                  </button>
                </div>
              )}
            </span>
          )}
          <button type="button" aria-label="Close thread" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>

      {messages === undefined ? (
        <div className="flex items-center justify-center py-8 text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto overscroll-contain">
          {messages.map((m, i) => (
            <MessageRow key={m.id} message={m} isFirst={i === 0} />
          ))}
        </ul>
      )}
      {error && <p className="px-3.5 pb-1 text-[12px] text-red-400">{error}</p>}

      <div className="border-t border-white/10 p-2.5">
        {c.canComment ? (
          <Composer key={thread.id} members={c.members} placeholder="Reply…" submitLabel="Reply" onSubmit={(body, ids) => c.reply(thread.id, body, ids)} />
        ) : (
          <p className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-zinc-500">
            <CornerUpLeft className="h-3.5 w-3.5" /> You can read this thread but not reply.
          </p>
        )}
      </div>
    </div>
  );
}
