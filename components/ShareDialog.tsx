"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";

export function ShareDialog({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"Viewer" | "Editor" | "Admin">("Viewer");
  const [isSending, setIsSending] = React.useState(false);

  const createInvite = useMutation(api.workspaces.createInvite);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSending(true);
    try {
      await createInvite({
        workspaceId,
        recipientEmail: email,
        role,
      });

      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          slateTitle: "Slate Workspace Boards",
          workspaceName: "Slate Workspace",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Fallback: trigger mailto if SMTP server fails or credentials are unset
        const subject = encodeURIComponent("Invitation to join Slate workspace");
        const body = encodeURIComponent(
          `Hello,\n\nI have added you to my Slate workspace with "${role}" access.\n\nYou can accept the invitation and access the workspace here:\n${window.location.origin}/dashboard\n\nBest regards!`
        );
        window.open(`mailto:${email.trim()}?subject=${subject}&body=${body}`, "_blank");
        alert("Invitation created in system! Opened your email client because SMTP is not configured yet on the server.");
      } else {
        alert("Invitation sent successfully via SMTP!");
      }

      setEmail("");
    } catch (error: any) {
      alert("Failed to send invite: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button className="bg-[#1A1A1A] border border-[#2B2B2B] text-white hover:bg-[#202020] text-xs h-8 px-3 rounded-lg flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5" />
          Share Workspace
        </Button>
      } />
      <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white p-6 max-w-sm rounded-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-base font-bold text-white">Invite to Workspace</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleInvite} className="space-y-4">
          <input
            type="email"
            required
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3 text-xs text-white outline-none focus:border-[#ffffff]"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            className="w-full h-10 rounded-xl border border-[#2B2B2B] bg-[#141414] px-3 text-xs text-white outline-none focus:border-[#ffffff]"
          >
            <option value="Viewer">Viewer</option>
            <option value="Editor">Editor</option>
            <option value="Admin">Admin</option>
          </select>
          <Button
            type="submit"
            disabled={isSending}
            className="w-full bg-[#ffffff] text-black text-xs h-10 rounded-xl hover:bg-[#e5e5e5]"
          >
            {isSending ? "Sending..." : "Send Invitation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
