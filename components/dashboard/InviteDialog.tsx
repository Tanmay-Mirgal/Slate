"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { Loader2, Mail } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Role = "Admin" | "Editor" | "Viewer";

const ROLES: { id: Role; hint: string }[] = [
  { id: "Editor", hint: "Can create and edit boards" },
  { id: "Viewer", hint: "Can view and comment" },
  { id: "Admin", hint: "Can also invite people and rename the workspace" },
];

const cleanError = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/, "") : fallback);

/** Invite a teammate to a workspace by email. The invite is recorded in Convex and mailed when SMTP is configured. */
export function InviteDialog({ open, onOpenChange, workspace }: { open: boolean; onOpenChange: (open: boolean) => void; workspace: { id: string; name: string } | null }) {
  const createInvite = useMutation(api.workspaces.createInvite);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("Editor");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!workspace || !address) return;
    setBusy(true);
    setNote(null);
    try {
      await createInvite({ workspaceId: workspace.id as Id<"workspaces">, recipientEmail: address, role });
      let mailed = false;
      try {
        const res = await fetch("/api/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: address, role, slateTitle: workspace.name, workspaceName: workspace.name }),
        });
        mailed = res.ok;
      } catch {
        mailed = false;
      }
      setNote({
        kind: "ok",
        text: mailed ? `Invitation emailed to ${address}.` : `Invitation created for ${address}. Email isn't configured here, so ask them to sign in with that address and accept it on their dashboard.`,
      });
      setEmail("");
    } catch (err) {
      setNote({ kind: "error", text: cleanError(err, "Could not send the invitation") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-4 rounded-2xl border border-white/10 bg-[#121215] p-5 text-white sm:max-w-[440px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Mail className="h-4 w-4" /> Invite to {workspace?.name ?? "workspace"}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">They&apos;ll see the invitation on their dashboard after signing in with this email.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <input
            required
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            aria-label="Email address"
            className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] text-white outline-none placeholder:text-zinc-600 focus:border-indigo-400/60"
          />
          <div className="grid gap-1.5" role="radiogroup" aria-label="Role">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={role === r.id}
                onClick={() => setRole(r.id)}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${role === r.id ? "border-indigo-400/50 bg-indigo-500/10" : "border-white/[0.07] hover:bg-white/[0.04]"}`}
              >
                <span className="text-[12.5px] font-medium text-zinc-100">{r.id}</span>
                <span className="text-[11px] text-zinc-500">{r.hint}</span>
              </button>
            ))}
          </div>
          {note && (
            <p role={note.kind === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-[12px] leading-snug ${note.kind === "ok" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200" : "border-red-500/25 bg-red-500/10 text-red-200"}`}>
              {note.text}
            </p>
          )}
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !email.trim()} className="flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-[12.5px] font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send invitation
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
