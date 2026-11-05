"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Unplug } from "lucide-react";
import { api } from "@/lib/client/api";
import { useMutation } from "@/lib/client/query";
import { timeAgo } from "@/lib/comments/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The shape `api.connector.overview` returns for a workspace (null when the connector is off). */
export interface ConnectedAppsData {
  hubName: string;
  seesAll: boolean;
  grants: {
    id: string;
    clientName: string;
    scopes: string[];
    connectedBy: { name: string; isYou: boolean };
    createdAt: number;
    lastUsedAt: number | null;
    webhooks: { id: string; host: string; status: "active" | "disabled"; disabledReason: string | null; lastDeliveryStatus: "succeeded" | "failed" | null; lastDeliveryAt: number | null }[];
  }[];
  activity: { id: string; at: number; method: string; route: string; status: number }[];
}

const SCOPE_LABEL: Record<string, string> = {
  "slate:workspaces:read": "See workspace",
  "slate:boards:read": "Read boards",
  "slate:boards:write": "Edit boards",
  "slate:ai:generate": "Use AI credits",
  "slate:comments:read": "Read comments",
  "slate:events:read": "Event log",
  "slate:webhooks:manage": "Webhooks",
};

function statusTone(status: number): string {
  if (status < 300) return "text-emerald-300 bg-emerald-400/10";
  if (status < 500) return "text-amber-300 bg-amber-400/10";
  return "text-rose-300 bg-rose-400/10";
}

/** Body of the "Connected apps" section: who is connected, how their webhooks are doing, what they did lately. */
export function ConnectedApps({ data }: { data: ConnectedAppsData }) {
  const revoke = useMutation(api.connector.revoke);
  const [confirming, setConfirming] = React.useState<ConnectedAppsData["grants"][number] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const disconnect = async () => {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      await revoke({ grantId: confirming.id });
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect the app");
    } finally {
      setBusy(false);
    }
  };

  if (data.grants.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-white/10 p-4">
        <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
        <p className="text-[12.5px] leading-relaxed text-zinc-500">
          No apps are connected. When you connect <span className="text-zinc-300">{data.hubName}</span> to this workspace it can create boards, generate diagrams, and tell you when a design is approved, always as you and never with
          more access than you have. Connections you approve will show up here, and you can disconnect them any time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {data.grants.map((g) => (
          <li key={g.id} className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-white">{g.clientName}</p>
                <p className="mt-0.5 text-[11.5px] text-zinc-500">
                  Connected by {g.connectedBy.isYou ? "you" : g.connectedBy.name} &middot; {timeAgo(g.createdAt)} ago &middot; {g.lastUsedAt ? `used ${timeAgo(g.lastUsedAt)} ago` : "not used yet"}
                </p>
              </div>
              {(g.connectedBy.isYou || data.seesAll) && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setConfirming(g);
                  }}
                  className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/30 bg-white/[0.03] px-3 text-[12px] font-semibold text-rose-300 transition-colors hover:bg-rose-950"
                >
                  <Unplug className="h-3.5 w-3.5" /> Revoke
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {g.scopes.map((s) => (
                <span key={s} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                  {SCOPE_LABEL[s] ?? s}
                </span>
              ))}
            </div>

            {g.webhooks.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3">
                {g.webhooks.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-[12px]">
                    {h.status === "active" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                    <span className="truncate font-mono text-zinc-300">{h.host}</span>
                    <span className="shrink-0 text-zinc-500">
                      {h.status === "disabled" ? `disabled${h.disabledReason ? `: ${h.disabledReason}` : ""}` : h.lastDeliveryAt ? `last delivery ${h.lastDeliveryStatus === "failed" ? "failed" : "ok"} ${timeAgo(h.lastDeliveryAt)} ago` : "waiting for the first event"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Recent connector activity</h4>
        {data.activity.length === 0 ? (
          <p className="text-[12px] text-zinc-600">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                <span className={`w-9 shrink-0 rounded px-1.5 py-px text-center text-[10.5px] font-semibold tabular-nums ${statusTone(a.status)}`}>{a.status}</span>
                <span className="w-10 shrink-0 text-[10.5px] font-semibold uppercase text-zinc-500">{a.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{a.route}</span>
                <span className="shrink-0 text-zinc-500">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && !busy && setConfirming(null)}>
        <DialogContent className="max-w-md rounded-2xl border border-white/10 bg-[#121215] p-6 text-white">
          <DialogHeader className="mb-1">
            <DialogTitle className="text-base font-semibold">Disconnect {confirming?.clientName}?</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] leading-relaxed text-zinc-400">
            It loses access immediately and its webhooks are removed. Boards it already created stay in your workspace. You can connect it again later.
          </p>
          {error && (
            <p role="alert" className="text-[12px] text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="h-9 cursor-pointer rounded-lg border border-white/10 px-4 text-[12.5px] font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50">
              Keep connected
            </button>
            <button type="button" disabled={busy} onClick={disconnect} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-rose-600 px-4 text-[12.5px] font-semibold text-white hover:bg-rose-500 disabled:opacity-50">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Disconnect
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
