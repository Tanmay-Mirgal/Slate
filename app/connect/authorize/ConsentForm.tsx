"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Bell, Building2, Eye, Loader2, MessageSquare, PencilLine, ShieldCheck, Sparkles, Webhook } from "lucide-react";

export interface ConsentScope {
  name: string;
  description: string;
}

export interface ConsentTenant {
  id: string;
  name: string;
  role: string;
}

interface Props {
  action: (formData: FormData) => Promise<void>;
  consent: string;
  hubName: string;
  redirectHost: string;
  user: { name: string; email: string };
  tenants: ConsentTenant[];
  scopes: ConsentScope[];
}

const ICONS: Record<string, React.ElementType> = {
  "slate:workspaces:read": Building2,
  "slate:boards:read": Eye,
  "slate:boards:write": PencilLine,
  "slate:ai:generate": Sparkles,
  "slate:comments:read": MessageSquare,
  "slate:events:read": Bell,
  "slate:webhooks:manage": Webhook,
};

/** Scopes that change things or spend something get a visible marker; the rest only read. */
const SENSITIVE: Record<string, string> = {
  "slate:boards:write": "Can change boards",
  "slate:ai:generate": "Uses your AI credits",
};

function Buttons({ canAllow }: { canAllow: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="submit"
        name="decision"
        value="deny"
        formNoValidate
        disabled={pending}
        className="h-10 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-5 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        name="decision"
        value="allow"
        disabled={pending || !canAllow}
        className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-5 text-[13px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Allow
      </button>
    </div>
  );
}

export function ConsentForm({ action, consent, hubName, redirectHost, user, tenants, scopes }: Props) {
  const [workspaceId, setWorkspaceId] = React.useState(tenants.length === 1 ? tenants[0].id : "");

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="consent" value={consent} />

      <section aria-labelledby="tenant-heading">
        <h2 id="tenant-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Workspace to connect
        </h2>
        {tenants.length === 0 ? (
          <p role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5 text-[12.5px] leading-relaxed text-amber-200">
            You don&apos;t have a workspace where you can grant these permissions. Writing needs the Admin or Editor role; ask a workspace admin, or open Slate once to create your own workspace.
          </p>
        ) : (
          <div role="radiogroup" className="space-y-2">
            {tenants.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 transition-colors hover:border-white/20 has-[:checked]:border-indigo-400/60 has-[:checked]:bg-indigo-400/[0.07]"
              >
                <input type="radio" name="workspaceId" value={t.id} required checked={workspaceId === t.id} onChange={() => setWorkspaceId(t.id)} className="h-4 w-4 accent-indigo-400" />
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[12px] font-bold uppercase text-zinc-300">{t.name.charAt(0)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{t.name}</span>
                <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-zinc-300">{t.role}</span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-zinc-500">The connection is limited to this one workspace.</p>
      </section>

      <section aria-labelledby="perm-heading">
        <h2 id="perm-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {hubName} will be able to
        </h2>
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-black/20">
          {scopes.map((s) => {
            const Icon = ICONS[s.name] ?? ShieldCheck;
            const flag = SENSITIVE[s.name];
            return (
              <li key={s.name} className="flex items-start gap-3 p-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-zinc-100">{s.description}</p>
                </div>
                {flag && <span className="shrink-0 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-300">{flag}</span>}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11.5px] leading-relaxed text-zinc-500">
          It acts as you ({user.email || user.name}) and can never do more than you can in Slate. You can disconnect it at any time in Workspace settings &rarr; Connected apps.
        </p>
      </section>

      <div className="space-y-3 border-t border-white/[0.06] pt-5">
        <p className="text-[11.5px] text-zinc-500">
          After you choose, you&apos;ll be sent back to <span className="font-medium text-zinc-300">{redirectHost}</span>.
        </p>
        <Buttons canAllow={tenants.length > 0 && workspaceId !== ""} />
      </div>
    </form>
  );
}
