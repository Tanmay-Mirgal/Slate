"use client";

import * as React from "react";
import { Check, ChevronDown, Plug } from "lucide-react";
import { api } from "@/lib/client/api";
import { useMutation } from "@/lib/client/query";
import { timeAgo } from "@/lib/comments/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type BoardStatus = "draft" | "in_review" | "approved";

export const STATUS_LABEL: Record<BoardStatus, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

export const STATUS_TONE: Record<BoardStatus, string> = {
  draft: "border-white/10 bg-white/[0.04] text-zinc-300",
  in_review: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
};

/** What `slates.getById` says about the connector (only present while it is switched on). */
export interface ConnectorView {
  hubName: string | null;
  status: BoardStatus;
  statusChangedAt: number | null;
  statusChangedByName: string | null;
  createdVia: "ui" | "connector";
}

interface Props {
  slateId: string;
  view: ConnectorView;
  /** Admins and Editors of the workspace; everybody else sees the pill read-only. */
  canChange: boolean;
}

/** Review state of a design (draft / in review / approved) and, when a Hub made the board, a small "Created via" tag. */
export function BoardStatusPill({ slateId, view, canChange }: Props) {
  const setStatus = useMutation(api.slates.setStatus);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const change = async (status: BoardStatus) => {
    if (status === view.status) return;
    setBusy(true);
    setError(null);
    try {
      await setStatus({ id: slateId, status });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the status");
    } finally {
      setBusy(false);
    }
  };

  const who = view.status !== "draft" && view.statusChangedByName && view.statusChangedAt ? `${STATUS_LABEL[view.status]} by ${view.statusChangedByName} · ${timeAgo(view.statusChangedAt)} ago` : STATUS_LABEL[view.status];
  const pill = `flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold ${STATUS_TONE[view.status]}`;

  return (
    <div className="flex items-center gap-1.5">
      {view.createdVia === "connector" && (
        <span className="hidden h-8 items-center gap-1 rounded-xl px-2 text-[11px] font-medium text-zinc-400 md:flex" title={`This board was created through ${view.hubName ?? "a connected app"}`}>
          <Plug className="h-3 w-3" /> Created via {view.hubName ?? "app"}
        </span>
      )}
      {canChange ? (
        <DropdownMenu>
          <DropdownMenuTrigger className={`${pill} cursor-pointer outline-none transition-colors hover:brightness-125 disabled:opacity-60`} disabled={busy} title={error ?? who} aria-label={`Status: ${who}. Change status`}>
            {STATUS_LABEL[view.status]}
            <ChevronDown className="h-3 w-3 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 border border-white/10 bg-[#121215] text-white">
            {(Object.keys(STATUS_LABEL) as BoardStatus[]).map((s) => (
              <DropdownMenuItem key={s} onClick={() => void change(s)} className="flex cursor-pointer items-center gap-2 text-xs">
                <span className="flex-1">{STATUS_LABEL[s]}</span>
                {s === view.status && <Check className="h-3.5 w-3.5 text-indigo-400" />}
              </DropdownMenuItem>
            ))}
            {view.status !== "draft" && view.statusChangedByName && <p className="px-2 pb-1.5 pt-1 text-[10.5px] leading-snug text-zinc-500">{who}</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className={pill} title={who}>
          {STATUS_LABEL[view.status]}
        </span>
      )}
    </div>
  );
}
