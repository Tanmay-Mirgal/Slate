import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { connectorConfig, connectorEnabled } from "@/lib/connector/config";
import { errorRedirect, validateAuthorizeRequest } from "@/lib/connector/oauth/authorize";
import { signConsent } from "@/lib/connector/oauth/consent";
import { roleSatisfies, SCOPES } from "@/lib/connector/scopes";
import { getCollections } from "@/lib/db/mongo";
import { displayName } from "@/lib/server/profile";
import { ensureUser } from "@/lib/server/users";
import { decide } from "./actions";
import { ConsentForm } from "./ConsentForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#09090b] px-4 py-10 font-sans text-white selection:bg-indigo-500/30">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Image src="/logo.svg" alt="" width={26} height={26} className="rounded-md" />
          <span className="text-[14px] font-bold tracking-tight">Slate</span>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-[#121215] p-6 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)]">{children}</div>
      </div>
    </main>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10">
          <AlertTriangle className="h-5 w-5 text-amber-300" />
        </div>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-[13px] leading-relaxed text-zinc-400">{message}</p>
        <Link href="/dashboard" className="inline-block rounded-xl border border-white/10 px-4 py-2 text-[13px] font-semibold text-zinc-200 hover:bg-white/10">
          Go to dashboard
        </Link>
      </div>
    </Shell>
  );
}

const SOFT_ERRORS: Record<string, { title: string; message: string }> = {
  expired: { title: "This page expired", message: "For your security the permission screen only works for a few minutes. Go back to the app and start the connection again." },
  workspace: { title: "That workspace isn't available", message: "You no longer have a role in that workspace that allows these permissions. Go back to the app and start the connection again." },
};

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!connectorEnabled()) notFound();
  const params = await searchParams;

  const soft = typeof params.connect_error === "string" ? SOFT_ERRORS[params.connect_error] : undefined;
  if (soft) return <ErrorCard {...soft} />;

  // 1. Is this really the registered app? Until it is, nothing may be redirected anywhere.
  const checked = validateAuthorizeRequest(params);
  if (checked.kind === "page_error") return <ErrorCard title={checked.title} message={checked.message} />;
  if (checked.kind === "redirect_error") redirect(errorRedirect(checked));
  const { request } = checked;

  // 2. Sign in with the normal Slate login and come back to exactly this URL.
  const { userId } = await auth();
  if (!userId) {
    const back = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const one of [v].flat()) if (one !== undefined) back.append(k, one);
    redirect(`/auth?mode=sign-in&redirect_url=${encodeURIComponent(`/connect/authorize?${back.toString()}`)}`);
  }

  // 3. Which workspaces can this person connect with these permissions?
  const c = await getCollections();
  const [user, memberships] = await Promise.all([ensureUser(userId), c.workspaceMembers.find({ userId }).sort({ addedAt: 1 }).limit(200).toArray()]);
  const workspaces = await c.workspaces.find({ _id: { $in: memberships.map((m) => m.workspaceId) } }).toArray();
  const names = new Map(workspaces.map((w) => [w._id, w.name]));
  const tenants = memberships
    .filter((m) => names.has(m.workspaceId) && roleSatisfies(m.role, request.scopes))
    .map((m) => ({ id: m.workspaceId, name: names.get(m.workspaceId)!, role: m.role }));

  const config = connectorConfig();
  return (
    <Shell>
      <div className="mb-6 space-y-1.5">
        <h1 className="text-[17px] font-semibold leading-snug tracking-tight">{config.hubName} wants to connect to your Slate account</h1>
        <p className="text-[12.5px] text-zinc-500">
          Signed in as <span className="text-zinc-300">{displayName(user)}</span>
          {user.email ? <span> &middot; {user.email}</span> : null}
        </p>
      </div>
      <ConsentForm
        action={decide}
        consent={signConsent(request, userId)}
        hubName={config.hubName}
        redirectHost={new URL(request.redirectUri).host}
        user={{ name: displayName(user), email: user.email }}
        tenants={tenants}
        scopes={request.scopes.map((name) => ({ name, description: SCOPES[name] }))}
      />
    </Shell>
  );
}
