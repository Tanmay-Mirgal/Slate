"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { Check, Copy, Eye, Globe, Loader2, Lock, Mail, Pencil, Share2, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type LinkAccess = "none" | "view" | "edit";

interface Props {
  slateId: Id<"slates">;
  title: string;
  workspaceId?: Id<"workspaces">;
  linkAccess: LinkAccess;
  canManage: boolean;
}

const OPTIONS: { id: LinkAccess; label: string; hint: string; icon: React.ElementType }[] = [
  { id: "none", label: "Restricted", hint: "Only people in this workspace", icon: Lock },
  { id: "view", label: "Anyone with the link can view", hint: "No sign-in needed", icon: Eye },
  { id: "edit", label: "Anyone with the link can edit", hint: "Signed-in users can change the board", icon: Pencil },
];

export function ShareSlateDialog({ slateId, title, workspaceId, linkAccess, canManage }: Props) {
  const [open, setOpen] = React.useState(false);
  const setLink = useMutation(api.slates.setLinkAccess);
  const createInvite = useMutation(api.workspaces.createInvite);
  const [pending, setPending] = React.useState<LinkAccess | null>(null);
  const [copied, setCopied] = React.useState<"edit" | "view" | null>(null);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"Viewer" | "Editor">("Editor");
  const [inviting, setInviting] = React.useState(false);
  const [note, setNote] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const url = typeof window !== "undefined" ? `${window.location.origin}/canvas/${slateId}` : "";
  const effective = pending ?? linkAccess;

  const change = async (next: LinkAccess) => {
    if (!canManage || next === effective) return;
    setPending(next);
    setNote(null);
    try {
      await setLink({ id: slateId, linkAccess: next });
    } catch (e) {
      setNote({ kind: "error", text: e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/, "") : "Could not update sharing" });
    } finally {
      setPending(null);
    }
  };

  const copy = async (mode: "edit" | "view") => {
    const text = mode === "view" ? `${url}?mode=view` : url;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(mode);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt("Copy this link", text);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !email.trim()) return;
    setInviting(true);
    setNote(null);
    try {
      await createInvite({ workspaceId, recipientEmail: email.trim(), role });
      let mailed = false;
      try {
        const res = await fetch("/api/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), role, slateTitle: title, workspaceName: "Slate Workspace" }),
        });
        mailed = res.ok;
      } catch {
        mailed = false;
      }
      setNote({
        kind: "ok",
        text: mailed ? `Invitation emailed to ${email.trim()}.` : `Invitation created for ${email.trim()}. Email isn't configured, so ask them to sign in with that address and accept it on their dashboard.`,
      });
      setEmail("");
    } catch (err) {
      setNote({ kind: "error", text: err instanceof Error ? err.message.replace(/^.*Uncaught Error:\s*/, "") : "Could not send the invitation" });
    } finally {
      setInviting(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-8 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-zinc-200">
        <Share2 className="h-3.5 w-3.5" />
        <span className="max-sm:hidden">Share</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[480px] gap-4 rounded-2xl border border-white/10 bg-[#111113] p-5 text-white sm:max-w-[480px]">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Users className="h-4 w-4" /> Share “{title || "Untitled"}”
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">Control who can open this board and what they can do.</DialogDescription>
          </DialogHeader>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <Globe className="h-3.5 w-3.5" /> General access
            </div>
            <div className="space-y-1.5">
              {OPTIONS.map((o) => {
                const active = effective === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => void change(o.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${active ? "border-indigo-400/50 bg-indigo-500/10" : "border-white/10 hover:bg-white/5"} ${!canManage && !active ? "opacity-40" : ""}`}
                  >
                    <o.icon className={`h-4 w-4 shrink-0 ${active ? "text-indigo-300" : "text-zinc-400"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-zinc-100">{o.label}</span>
                      <span className="block text-[11.5px] text-zinc-500">{o.hint}</span>
                    </span>
                    {pending === o.id ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : active ? <Check className="h-4 w-4 text-indigo-300" /> : null}
                  </button>
                );
              })}
            </div>
            {!canManage && <p className="mt-2 text-[11.5px] text-zinc-500">Only workspace members can change sharing.</p>}
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11.5px] text-zinc-300 outline-none" />
              <button type="button" onClick={() => void copy("edit")} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black hover:bg-zinc-200">
                {copied === "edit" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy link
              </button>
            </div>
            <button type="button" onClick={() => void copy("view")} className="flex items-center gap-1.5 text-[11.5px] text-zinc-500 hover:text-zinc-200">
              {copied === "view" ? <Check className="h-3 w-3 text-emerald-400" /> : <Eye className="h-3 w-3" />} Copy a link that opens in view-only mode
            </button>
          </div>

          {workspaceId && canManage && (
            <form onSubmit={invite} className="border-t border-white/10 pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <Mail className="h-3.5 w-3.5" /> Invite to workspace
              </div>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-white/30"
                />
                <select value={role} onChange={(e) => setRole(e.target.value as "Viewer" | "Editor")} className="rounded-lg border border-white/10 bg-black/40 px-2 text-xs text-zinc-200 outline-none">
                  <option value="Editor">Can edit</option>
                  <option value="Viewer">Can view</option>
                </select>
                <button type="submit" disabled={inviting} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50">
                  {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Invite
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-600">Invited people get access to every board in this workspace.</p>
            </form>
          )}

          {note && <div className={`rounded-lg px-3 py-2 text-[12px] ${note.kind === "ok" ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"}`}>{note.text}</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
