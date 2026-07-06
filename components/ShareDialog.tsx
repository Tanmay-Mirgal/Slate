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
      setEmail("");
      alert("Invite sent successfully!");
    } catch (error: any) {
      alert("Failed to send invite: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#1A1A1A] border border-[#2B2B2B] text-white hover:bg-[#202020] text-xs h-8 px-3 rounded-lg flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5" />
          Share Workspace
        </Button>
      </DialogTrigger>
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
