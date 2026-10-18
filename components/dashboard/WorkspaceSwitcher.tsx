"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Mail, Plus, Settings, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Tier } from "@/lib/billing/plans";
import { PlanBadge, WorkspaceAvatar } from "./bits";

export interface SwitcherWorkspace {
  _id: string;
  name: string;
  role: string;
  memberCount: number;
  plan: Tier;
}

interface WorkspaceSwitcherProps {
  workspaces: SwitcherWorkspace[] | undefined;
  activeId: string | null;
  fallbackName: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSettings: () => void;
  onInvite: () => void;
}

const members = (n: number) => `${n} member${n === 1 ? "" : "s"}`;

/** Sidebar workspace picker: avatar, member count and plan, with workspace-level actions underneath. */
export function WorkspaceSwitcher({ workspaces, activeId, fallbackName, onSelect, onCreate, onSettings, onInvite }: WorkspaceSwitcherProps) {
  const active = workspaces?.find((w) => w._id === activeId) ?? null;
  const name = active?.name ?? fallbackName;
  const isAdmin = active?.role === "Admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-[#121215] p-2 text-left outline-none transition-colors hover:border-white/15 hover:bg-[#17171b] focus-visible:border-indigo-400/60 data-popup-open:border-white/15 data-popup-open:bg-[#17171b]"
        aria-label="Switch workspace"
      >
        <WorkspaceAvatar name={name} size={32} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-white">{workspaces === undefined ? "Loading…" : name}</span>
            {active && <PlanBadge tier={active.plan} />}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
            <Users className="h-3 w-3" />
            {active ? members(active.memberCount) : "—"}
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-colors group-hover:text-zinc-300" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="w-64 border border-white/10 bg-[#121215] p-1.5 text-white shadow-2xl">
        <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Workspaces</div>
        <div className="max-h-56 overflow-y-auto">
          {workspaces?.map((w) => (
            <DropdownMenuItem key={w._id} onClick={() => onSelect(w._id)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs focus:bg-white/[0.06]">
              <WorkspaceAvatar name={w.name} size={26} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-zinc-100">{w.name}</span>
                  <PlanBadge tier={w.plan} />
                </span>
                <span className="text-[10.5px] text-zinc-500">{members(w.memberCount)}</span>
              </span>
              {w._id === activeId && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-400" />}
            </DropdownMenuItem>
          ))}
          {workspaces?.length === 0 && <div className="px-2 py-3 text-[11.5px] text-zinc-500">No workspaces yet.</div>}
        </div>
        <DropdownMenuSeparator className="my-1.5 bg-white/[0.07]" />
        <DropdownMenuItem onClick={onSettings} disabled={!active} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:bg-white/[0.06]">
          <Settings className="h-3.5 w-3.5 text-zinc-500" /> Workspace Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onInvite} disabled={!isAdmin} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:bg-white/[0.06]">
          <Mail className="h-3.5 w-3.5 text-zinc-500" />
          <span className="flex-1">Invite Teammate via Email</span>
          {active && !isAdmin && <span className="text-[10px] text-zinc-600">Admins only</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreate} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:bg-white/[0.06]">
          <Plus className="h-3.5 w-3.5 text-zinc-500" /> Create New Workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
