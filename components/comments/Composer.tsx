"use client";

import * as React from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Loader2, SendHorizontal } from "lucide-react";
import { activeMentionQuery, MAX_BODY, mentionedIn, searchPeople } from "@/lib/comments/logic";
import type { MentionCandidate } from "@/lib/comments/types";
import { Avatar } from "./Avatar";

interface ComposerProps {
  members: MentionCandidate[];
  initial?: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  onSubmit: (body: string, mentionIds: string[]) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Comment box with @mention autocomplete. Enter posts, Shift+Enter adds a line, Esc cancels.
 * Mentions are plain "@Name" text; on submit the people really named in it are sent along.
 */
export function Composer({ members, initial = "", placeholder = "Add a comment…  @ to mention", submitLabel = "Send", autoFocus, onSubmit, onCancel }: ComposerProps) {
  const [text, setText] = React.useState(initial);
  const [caret, setCaret] = React.useState(initial.length);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    if (!autoFocus) return;
    // the pin was just dropped with a pointer press; focus after that press has settled
    const t = setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 30);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const q = activeMentionQuery(text, caret);
  const options = q && q.start !== dismissedAt ? searchPeople(members, q.query) : [];
  const open = options.length > 0;
  const safeActive = Math.min(active, Math.max(0, options.length - 1));

  const pick = (p: MentionCandidate) => {
    if (!q) return;
    const insert = `@${p.name} `;
    const next = text.slice(0, q.start) + insert + text.slice(caret);
    const pos = q.start + insert.length;
    setText(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body, mentionedIn(body, members).map((m) => m.userId));
      setText("");
      setCaret(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post that comment");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((safeActive + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((safeActive - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[safeActive]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(q!.start);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="relative">
      {open && (
        <ul role="listbox" aria-label="Mention a teammate" className="absolute inset-x-0 bottom-full z-10 mb-1.5 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#1b1b1f] p-1 shadow-2xl">
          {options.map((p, i) => (
            <li key={p.userId} role="option" aria-selected={i === safeActive}>
              <button
                type="button"
                // keep focus in the textarea
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${i === safeActive ? "bg-indigo-500/20 text-white" : "text-zinc-300"}`}
              >
                <Avatar userId={p.userId} name={p.name} src={p.avatar} size={20} />
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-white/10 bg-black/30 focus-within:border-indigo-400/60">
        <TextareaAutosize
          ref={ref}
          value={text}
          minRows={1}
          maxRows={6}
          maxLength={MAX_BODY}
          disabled={busy}
          placeholder={placeholder}
          aria-label="Comment"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
            setDismissedAt(null);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown}
          className="block w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[13px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
          <span className="px-1 text-[10.5px] text-zinc-600">{text.length > MAX_BODY - 200 ? `${text.length}/${MAX_BODY}` : "Enter to send · Shift+Enter for a new line"}</span>
          <div className="flex items-center gap-1">
            {onCancel && (
              <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[12px] font-medium text-zinc-400 hover:bg-white/10 hover:text-white">
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || text.trim().length === 0}
              className="flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors enabled:hover:bg-indigo-400 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 px-1 text-[12px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
