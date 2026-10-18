"use client";

import * as React from "react";
import { Check, MessageSquarePlus, X } from "lucide-react";
import type { Engine } from "@/lib/canvas/engine";
import { colorFor } from "@/lib/canvas/peers";
import { anchorAt, resolveAnchor } from "@/lib/comments/anchor";
import { matchesFilter } from "@/lib/comments/filter";
import { initialsOf } from "@/lib/comments/format";
import type { Anchor, ThreadSummary } from "@/lib/comments/types";
import { Composer } from "./Composer";
import { useComments, type CommentsApi } from "./context";
import { ThreadCard } from "./ThreadCard";

const POPOVER_GAP = 16;
const TOP_SAFE = 64; // below the top bar

/** Comment pins as DOM nodes (crisp at any zoom, never repainted with the canvas), the thread popover and the new-comment box. */
export function CommentsLayer({ engine }: { engine: Engine }) {
  const c = useComments();
  return c ? <Layer engine={engine} c={c} /> : null;
}

function Layer({ engine, c }: { engine: Engine; c: CommentsApi }) {
  const { canComment, startDraft, openThread, openThreadId, draft, markRead } = c;
  const pins = React.useRef(new Map<string, HTMLDivElement>());
  const draftPin = React.useRef<HTMLDivElement | null>(null);
  const popover = React.useRef<HTMLDivElement | null>(null);

  const threads = c.threads;
  const shown = React.useMemo(() => (threads ?? []).filter((t) => matchesFilter(t, c.filter) || t.id === openThreadId), [threads, c.filter, openThreadId]);
  const open = React.useMemo(() => (openThreadId ? threads?.find((t) => t.id === openThreadId) : undefined), [threads, openThreadId]);

  // the Comment tool drops a pin through the engine
  React.useEffect(() => {
    engine.configure({
      commentsEnabled: canComment,
      onPlaceComment: (at, elementId) => startDraft(anchorAt(at, elementId ? engine.store.get(elementId) : null)),
    });
    return () => engine.configure({ commentsEnabled: false, onPlaceComment: null });
  }, [engine, canComment, startDraft]);

  // opening a thread marks it as read (again, if someone replies while it is open)
  React.useEffect(() => {
    if (open?.unread) markRead(open.id);
  }, [open?.id, open?.unread, markRead]);

  // a thread that was deleted (by anyone) closes its popover
  React.useEffect(() => {
    if (openThreadId && threads && !threads.some((t) => t.id === openThreadId)) openThread(null);
  }, [openThreadId, threads, openThread]);

  /** Moves every pin (and the popover) to where its anchor is on screen right now. */
  const place = React.useCallback(() => {
    const cam = engine.camera;
    const W = engine.width;
    const H = engine.height;
    const get = (id: string) => engine.store.get(id);
    const screen = (a: Anchor) => {
      const p = resolveAnchor(a, get);
      return { x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y };
    };
    const put = (el: HTMLElement | null | undefined, a: Anchor | undefined) => {
      if (!el || !a) return null;
      const s = screen(a);
      el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
      el.style.display = s.x < -50 || s.y < -10 || s.x > W + 50 || s.y > H + 50 ? "none" : "";
      return s;
    };
    for (const t of shown) put(pins.current.get(t.id), t.anchor);
    const dp = put(draftPin.current, draft ?? undefined);
    const pop = popover.current;
    const anchor = draft ?? open?.anchor;
    if (pop && anchor) {
      const s = dp ?? screen(anchor);
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      let left = s.x + POPOVER_GAP + 18;
      if (left + w > W - 8) left = s.x - POPOVER_GAP - w;
      left = Math.max(8, Math.min(left, W - w - 8));
      const top = Math.max(TOP_SAFE, Math.min(s.y - 40, H - h - 12));
      pop.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      pop.style.opacity = "1";
    }
  }, [engine, shown, draft, open]);

  // content (and so the popover's size) can change on any render, so re-place after each one
  React.useLayoutEffect(() => place());
  React.useEffect(() => {
    const off = [engine.subscribeCamera(place), engine.store.subscribe(place)];
    return () => off.forEach((f) => f());
  }, [engine, place]);

  // click elsewhere or Esc closes whatever is open (an unposted pin is discarded)
  React.useEffect(() => {
    if (!openThreadId && !draft) return;
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-comment-ui]")) return;
      openThread(null);
      startDraft(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      openThread(null);
      startDraft(null);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [openThreadId, draft, openThread, startDraft]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-comments-layer>
      {shown.map((t) => (
        <div
          key={t.id}
          ref={(el) => {
            if (el) pins.current.set(t.id, el);
            else pins.current.delete(t.id);
          }}
          className="absolute left-0 top-0 will-change-transform"
          style={{ display: "none" }}
          data-comment-ui
        >
          <Pin thread={t} selected={t.id === openThreadId} onClick={() => openThread(t.id === openThreadId ? null : t.id)} />
        </div>
      ))}

      {draft && (
        <>
          <div ref={draftPin} className="absolute left-0 top-0 will-change-transform" data-comment-ui>
            <span className="pointer-events-none absolute bottom-0 left-0 flex h-[30px] w-[30px] items-center justify-center rounded-full rounded-bl-none border-2 border-white bg-indigo-500 text-white shadow-lg motion-safe:animate-[pulse_1.6s_ease-in-out_infinite]">
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </span>
          </div>
          <div ref={popover} className="pointer-events-auto absolute left-0 top-0 w-[320px] max-w-[calc(100vw-24px)] opacity-0" data-comment-ui>
            <div className="rounded-2xl border border-white/10 bg-[#141416]/98 p-2.5 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl" role="dialog" aria-label="New comment">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12px] font-semibold text-zinc-300">New comment</span>
                <button type="button" aria-label="Cancel comment" onClick={() => startDraft(null)} className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Composer
                members={c.members}
                autoFocus
                submitLabel="Comment"
                onCancel={() => startDraft(null)}
                onSubmit={async (body, mentions) => {
                  const id = await c.createThread({ anchor: draft, body, mentions });
                  openThread(id);
                }}
              />
            </div>
          </div>
        </>
      )}

      {!draft && open && (
        <div ref={popover} className="pointer-events-auto absolute left-0 top-0 opacity-0" data-comment-ui>
          <ThreadCard thread={open} onClose={() => openThread(null)} />
        </div>
      )}
    </div>
  );
}

function Pin({ thread, selected, onClick }: { thread: ThreadSummary; selected: boolean; onClick: () => void }) {
  const resolved = thread.status === "resolved";
  const label = `${thread.author.name}: ${thread.snippet}${thread.replyCount ? ` (${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"})` : ""}${resolved ? " — resolved" : ""}${thread.unread ? " — unread" : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={`pointer-events-auto absolute bottom-0 left-0 flex h-[30px] w-[30px] origin-bottom-left items-center justify-center rounded-full rounded-bl-none border-2 text-[11px] font-bold text-white shadow-[0_4px_14px_rgba(0,0,0,0.45)] transition-transform duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
        selected ? "scale-110 border-white ring-2 ring-indigo-400" : thread.mentionsMe ? "border-amber-300" : "border-white/90"
      } ${resolved ? "opacity-70 saturate-50" : ""}`}
      style={{ background: resolved ? "#52525b" : colorFor(thread.author.userId) }}
    >
      {resolved ? <Check className="h-3.5 w-3.5" /> : thread.author.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thread.author.avatar} alt="" className="h-full w-full rounded-full rounded-bl-none object-cover" referrerPolicy="no-referrer" />
      ) : (
        initialsOf(thread.author.name)
      )}
      {thread.unread && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0a0a0a] bg-red-500" />}
      {thread.replyCount > 0 && (
        <span className="absolute -bottom-1.5 -right-1.5 min-w-[16px] rounded-full border border-[#0a0a0a] bg-zinc-900 px-1 text-center text-[9.5px] font-semibold leading-[14px] text-zinc-200">{thread.replyCount}</span>
      )}
    </button>
  );
}
