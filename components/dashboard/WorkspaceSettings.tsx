"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { Crown, Mail, Pencil, Sparkles, UserPlus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PLANS } from "@/lib/billing/plans";
import { timeAgo } from "@/lib/comments/format";
import { PlanBadge, UsageBar, WorkspaceAvatar } from "./bits";
import type { MeterBilling } from "./UsageMeter";
import type { SwitcherWorkspace } from "./WorkspaceSwitcher";

interface WorkspaceSettingsProps {
  workspace: SwitcherWorkspace | null;
  billing: MeterBilling | null | undefined;
  onInvite: () => void;
  onUpgrade: () => void;
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#121215]">
      <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h3 className="text-[13px] font-semibold text-white">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] text-zinc-500">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function WorkspaceSettings({ workspace, billing, onInvite, onUpgrade }: WorkspaceSettingsProps) {
  const id = workspace?._id as Id<"workspaces"> | undefined;
  const members = useQuery(api.workspaces.listMembers, id ? { workspaceId: id } : "skip");
  const invites = useQuery(api.workspaces.listPendingInvites, id ? { workspaceId: id } : "skip");
  const rename = useMutation(api.workspaces.renameWorkspace);
  const [name, setName] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!workspace) {
    return <p className="rounded-2xl border border-white/[0.07] bg-[#121215] p-8 text-center text-[13px] text-zinc-500">Select or create a workspace to manage it.</p>;
  }

  const isAdmin = workspace.role === "Admin";
  const value = name ?? workspace.name;
  const dirty = value.trim() !== workspace.name && value.trim().length > 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || !id) return;
    setSaving(true);
    setError(null);
    try {
      await rename({ id, name: value.trim() });
      setName(null);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*Uncaught Error:\s*/, "") : "Could not rename the workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Section title="General" description="How this workspace appears to your team.">
        <form onSubmit={save} className="flex items-end gap-3">
          <WorkspaceAvatar name={workspace.name} size={44} />
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-medium text-zinc-500">Workspace name</span>
            <input
              value={value}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              maxLength={60}
              className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] text-white outline-none focus:border-indigo-400/60 disabled:opacity-60"
            />
          </label>
          {isAdmin && (
            <button type="submit" disabled={!dirty || saving} className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-[12.5px] font-semibold text-black hover:bg-zinc-200 disabled:opacity-40">
              <Pencil className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
            </button>
          )}
        </form>
        {error && <p role="alert" className="mt-3 text-[12px] text-red-300">{error}</p>}
        {!isAdmin && <p className="mt-3 text-[12px] text-zinc-500">Only workspace admins can rename it.</p>}
      </Section>

      <Section
        title="Plan & usage"
        description={`This workspace is on the ${PLANS[workspace.plan].name} plan.`}
        action={
          <button type="button" onClick={onUpgrade} className="flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 text-[12px] font-semibold text-white hover:brightness-110">
            <Sparkles className="h-3.5 w-3.5" /> {workspace.plan === "free" ? "Upgrade" : "Change plan"}
          </button>
        }
      >
        <div className="mb-4 flex items-center gap-2">
          <PlanBadge tier={workspace.plan} />
          <span className="text-[12px] text-zinc-500">{PLANS[workspace.plan].tagline}</span>
        </div>
        {billing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <UsageBar label="Slates created" value={billing.boards.used} max={billing.boards.limit} />
            <UsageBar label="AI credits this month" value={billing.ai.used} max={billing.ai.cap} />
          </div>
        ) : (
          <p className="text-[12px] text-zinc-500">Usage appears here once you&apos;re signed in.</p>
        )}
        <p className="mt-3 text-[11px] text-zinc-600">Usage is counted for the workspace owner&apos;s plan.</p>
      </Section>

      <Section
        title="Members"
        description={`${workspace.memberCount} ${workspace.memberCount === 1 ? "person has" : "people have"} access.`}
        action={
          isAdmin ? (
            <button type="button" onClick={onInvite} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12px] font-semibold text-zinc-100 hover:bg-white/[0.08]">
              <UserPlus className="h-3.5 w-3.5" /> Invite
            </button>
          ) : undefined
        }
      >
        {members === undefined ? (
          <div className="space-y-2" aria-label="Loading members">
            {[0, 1].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                {m.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <WorkspaceAvatar name={m.name} size={32} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-white">
                    {m.name}
                    {m.isYou && <span className="text-[10.5px] font-normal text-zinc-500">(you)</span>}
                    {m.isOwner && <Crown className="h-3 w-3 text-amber-400" aria-label="Owner" />}
                  </p>
                  {m.email && <p className="truncate text-[11.5px] text-zinc-500">{m.email}</p>}
                </div>
                <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-zinc-300">{m.role}</span>
              </li>
            ))}
          </ul>
        )}

        {invites && invites.length > 0 && (
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Pending invitations</h4>
            <ul className="space-y-1.5">
              {invites.map((i) => (
                <li key={i._id} className="flex items-center gap-2.5 text-[12.5px] text-zinc-300">
                  <Mail className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <span className="text-[11px] text-zinc-500">{i.role} · {timeAgo(i.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}
