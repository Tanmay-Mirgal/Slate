"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock, Link2, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { timeAgo } from "@/lib/comments/format";

export interface CardSlate {
  _id: string;
  title: string;
  lastEdited: number;
  thumbnailIcon: string;
  linkAccess?: "none" | "view" | "edit";
  isFavorite: boolean;
  nodeCount: number | null;
  connectorCount: number | null;
  workspaceName?: string;
}

export interface CardPerson {
  name: string;
  avatar: string | null;
  color: string;
}

interface BoardCardProps {
  slate: CardSlate;
  people?: CardPerson[];
  onToggleFavorite: (id: string, favorite: boolean) => void;
  /** Omit for boards the viewer can't manage (shared with them). */
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  /** Extra content under the card body, e.g. who shared it. */
  footer?: React.ReactNode;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function counts(slate: CardSlate): string {
  if (slate.nodeCount === null) return "Open to count";
  if (slate.nodeCount === 0 && (slate.connectorCount ?? 0) === 0) return "Empty board";
  return `${plural(slate.nodeCount, "node")} • ${plural(slate.connectorCount ?? 0, "connector")}`;
}

export function BoardCard({ slate, people = [], onToggleFavorite, onRename, onDelete, footer }: BoardCardProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(slate.title);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const live = people.length;
  const thumb = ["1", "2", "3", "4", "5"].includes(slate.thumbnailIcon) ? `/illustration_${slate.thumbnailIcon}.svg` : "/illustration_1.svg";

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startRename = () => {
    if (!onRename) return;
    setDraft(slate.title);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== slate.title) onRename?.(slate._id, next);
  };

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#121215] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)]">
      <Link href={`/canvas/${slate._id}`} className="relative block h-40 overflow-hidden border-b border-white/[0.06] bg-gradient-to-br from-[#0e0e11] to-[#16161b]" aria-label={`Open ${slate.title}`}>
        <Image src={thumb} alt="" fill sizes="(min-width: 1024px) 33vw, 50vw" className="object-cover opacity-70 mix-blend-luminosity transition-transform duration-500 group-hover:scale-105" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#121215] via-transparent to-transparent" />
      </Link>

      {/* favourite */}
      <button
        type="button"
        aria-pressed={slate.isFavorite}
        aria-label={slate.isFavorite ? "Remove from starred" : "Star this board"}
        title={slate.isFavorite ? "Starred" : "Star"}
        onClick={() => onToggleFavorite(slate._id, !slate.isFavorite)}
        className={`absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-md transition-all ${
          slate.isFavorite ? "border-amber-400/30 bg-amber-400/15 text-amber-300 opacity-100" : "border-white/10 bg-black/40 text-zinc-400 opacity-0 hover:text-amber-300 focus-visible:opacity-100 group-hover:opacity-100"
        }`}
      >
        <Star className={`h-4 w-4 ${slate.isFavorite ? "fill-amber-300" : ""}`} />
      </button>

      {/* who is here right now */}
      {live > 0 && (
        <div className="absolute bottom-[72px] left-3 flex items-center gap-2 rounded-full border border-emerald-400/25 bg-black/60 py-1 pl-1 pr-2.5 backdrop-blur-md" title={`${people.map((p) => p.name).join(", ")} ${live === 1 ? "is" : "are"} editing now`}>
          <span className="flex -space-x-1.5">
            {people.slice(0, 3).map((p) => (
              <span key={p.name + p.color} className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-[#121215] text-[9px] font-bold uppercase text-white" style={{ background: p.color }}>
                {p.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.avatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  p.name.charAt(0)
                )}
              </span>
            ))}
          </span>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[10.5px] font-medium text-emerald-300">{live} live</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2 p-3.5">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              maxLength={120}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label="Board title"
              className="w-full rounded-md border border-indigo-400/50 bg-black/40 px-2 py-0.5 text-[13px] font-semibold text-white outline-none"
            />
          ) : (
            <h3 className="truncate text-[13px] font-semibold text-white" onDoubleClick={startRename} title={onRename ? "Double-click to rename" : slate.title}>
              {slate.title}
            </h3>
          )}
          <p className="mt-1 truncate text-[11.5px] tabular-nums text-zinc-400">{counts(slate)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Clock className="h-3 w-3" /> Edited {timeAgo(slate.lastEdited)}
            {slate.linkAccess && slate.linkAccess !== "none" && (
              <span className="ml-1 flex items-center gap-1 rounded bg-white/[0.05] px-1 py-px text-[9.5px] font-medium text-zinc-400" title="Anyone with the link can open this board">
                <Link2 className="h-2.5 w-2.5" /> {slate.linkAccess === "edit" ? "Link: edit" : "Link: view"}
              </span>
            )}
            {slate.workspaceName && <span className="truncate text-sky-400/80">· {slate.workspaceName}</span>}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="shrink-0 cursor-pointer rounded-lg p-1.5 text-zinc-500 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.06]" aria-label="Board actions">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 border border-white/10 bg-[#121215] text-white">
            <DropdownMenuItem onClick={() => onToggleFavorite(slate._id, !slate.isFavorite)} className="flex cursor-pointer items-center gap-2 text-xs">
              <Star className="h-3.5 w-3.5" /> {slate.isFavorite ? "Remove star" : "Star"}
            </DropdownMenuItem>
            {onRename && (
              <DropdownMenuItem onClick={startRename} className="flex cursor-pointer items-center gap-2 text-xs">
                <Pencil className="h-3.5 w-3.5" /> Rename
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem onClick={() => onDelete(slate._id)} className="flex cursor-pointer items-center gap-2 text-xs text-rose-400">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {footer}
    </article>
  );
}
