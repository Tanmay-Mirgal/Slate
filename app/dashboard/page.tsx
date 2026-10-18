"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { UserButton, useUser } from "@clerk/nextjs";
import { Bell, Check, Clock, Command, Plus, Search, Settings, Share2, Star, Users, X, Briefcase, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CommandPalette } from "@/components/CommandPalette";
import { PricingModal } from "@/components/billing/PricingModal";
import { BoardCard, type CardPerson } from "@/components/dashboard/BoardCard";
import { InviteDialog } from "@/components/dashboard/InviteDialog";
import { TemplateRail } from "@/components/dashboard/TemplateRail";
import { UsageMeter } from "@/components/dashboard/UsageMeter";
import { WorkspaceSettings } from "@/components/dashboard/WorkspaceSettings";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/dashboard/WorkspaceSwitcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isBillingErrorData, type BillingErrorCode } from "@/lib/billing/limits";
import type { StarterId, StarterTemplate } from "@/lib/diagram/starter-templates";

export type DashboardTab = "recent" | "shared" | "settings";

const surface = "border border-white/[0.07] bg-[#121215]";

function NavButton({ active, onClick, icon: Icon, children, badge }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-indigo-400/60 ${
        active ? "bg-white/[0.07] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
      }`}
    >
      {active && <span aria-hidden className="absolute -left-2 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-indigo-400" />}
      <Icon className={`h-4 w-4 ${active ? "text-indigo-300" : "text-zinc-500"}`} />
      <span className="flex-1 text-left">{children}</span>
      {badge ? <span className="min-w-[18px] rounded-full bg-sky-500/20 px-1.5 py-0.5 text-center text-[10px] font-bold text-sky-300">{badge}</span> : null}
    </button>
  );
}

function SectionTitle({ icon: Icon, children, count }: { icon?: React.ElementType; children: React.ReactNode; count?: number }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
      {count !== undefined && <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] tabular-nums text-zinc-400">{count}</span>}
    </h3>
  );
}

const grid = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useUser();

  const workspaces = useQuery(api.workspaces.listMyWorkspaces);
  const createWorkspace = useMutation(api.workspaces.create);
  const [selectedWorkspaceId, setActiveWorkspaceId] = React.useState<Id<"workspaces"> | null>(null);
  // Fall back to the first workspace until the user picks one.
  const activeWorkspaceId = selectedWorkspaceId ?? (workspaces && workspaces.length > 0 ? (workspaces[0]._id as Id<"workspaces">) : null);
  const activeWorkspace = (workspaces?.find((w) => w._id === activeWorkspaceId) ?? null) as SwitcherWorkspace | null;

  const slates = useQuery(api.slates.list, activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip");
  const sharedSlates = useQuery(api.slates.listShared);
  const sharedByMeSlates = useQuery(api.slates.listSharedByMe);
  const pendingInvites = useQuery(api.workspaces.getMyPendingInvites);
  const billing = useQuery(api.billing.getMyBilling);
  const respondToInvite = useMutation(api.workspaces.respondToInvite);
  const createSlate = useMutation(api.slates.create);
  const removeSlate = useMutation(api.slates.remove);
  const renameSlate = useMutation(api.slates.rename);
  const setFavorite = useMutation(api.slates.setFavorite);

  const [respondingId, setRespondingId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<DashboardTab>("recent");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [starredOnly, setStarredOnly] = React.useState(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = React.useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = React.useState("");
  const [isInviteOpen, setIsInviteOpen] = React.useState(false);
  const [pricing, setPricing] = React.useState<{ open: boolean; reason: BillingErrorCode | null }>({ open: false, reason: null });
  const [templateBusy, setTemplateBusy] = React.useState<StarterId | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const openPricing = React.useCallback((reason: BillingErrorCode | null = null) => setPricing({ open: true, reason }), []);

  /** True when the free plan has no room for another board; the pricing modal explains why. */
  const atBoardLimit = !!billing && billing.boards.limit !== null && billing.boards.used !== null && billing.boards.used >= billing.boards.limit;

  const showError = (e: unknown, fallback: string) => {
    if (e instanceof ConvexError && isBillingErrorData(e.data)) {
      openPricing(e.data.code);
      return;
    }
    console.error(e);
    setNotice(e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/, "") : fallback);
  };

  const handleInviteResponse = async (inviteId: Id<"invites">, accept: boolean) => {
    setRespondingId(inviteId);
    try {
      await respondToInvite({ inviteId, accept });
      if (accept) setActiveWorkspaceId(null); // refresh the workspace list by clearing the cached selection
    } catch (err) {
      showError(err, "Could not answer that invitation");
    } finally {
      setRespondingId(null);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    try {
      const id = await createWorkspace({ name: newWorkspaceName.trim() });
      setActiveWorkspaceId(id);
      setIsCreateWorkspaceOpen(false);
      setNewWorkspaceName("");
      setActiveTab("recent");
    } catch (err) {
      showError(err, "Could not create the workspace");
    }
  };

  const requestNewBoard = () => {
    if (atBoardLimit) openPricing("board_limit");
    else setIsCreateOpen(true);
  };

  const handleCreateSlate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !activeWorkspaceId) return;
    setIsCreating(true);
    try {
      const id = await createSlate({ title: newTitle.trim(), workspaceId: activeWorkspaceId, thumbnailIcon: String(Math.floor(Math.random() * 5) + 1) });
      setIsCreateOpen(false);
      setNewTitle("");
      router.push(`/canvas/${id}`);
    } catch (err) {
      setIsCreateOpen(false);
      showError(err, "Could not create the board");
    } finally {
      setIsCreating(false);
    }
  };

  /** Clones a starter: creates the board, then the canvas lays the template out when it opens. */
  const handleTemplate = async (t: StarterTemplate) => {
    if (!activeWorkspaceId || templateBusy) {
      if (!activeWorkspaceId) setNotice("Create or select a workspace first.");
      return;
    }
    if (atBoardLimit) {
      openPricing("board_limit");
      return;
    }
    setTemplateBusy(t.id);
    try {
      const id = await createSlate({ title: t.boardTitle, workspaceId: activeWorkspaceId, thumbnailIcon: t.thumbnailIcon });
      router.push(`/canvas/${id}?template=${t.id}`);
    } catch (err) {
      showError(err, "Could not create the board");
      setTemplateBusy(null);
    }
  };

  const toggleFavorite = (id: string, favorite: boolean) => {
    setFavorite({ id: id as Id<"slates">, favorite }).catch((err) => showError(err, "Could not update the star"));
  };
  const rename = (id: string, title: string) => {
    renameSlate({ id: id as Id<"slates">, title }).catch((err) => showError(err, "Could not rename the board"));
  };
  const remove = (id: string) => {
    const slate = slates?.find((s) => s._id === id);
    if (!window.confirm(`Delete “${slate?.title ?? "this board"}”? It will be removed from your dashboard.`)) return;
    removeSlate({ id: id as Id<"slates"> }).catch((err) => showError(err, "Could not delete the board"));
  };

  const q = searchQuery.trim().toLowerCase();
  const matches = <T extends { title: string; isFavorite: boolean }>(s: T) => s.title.toLowerCase().includes(q) && (!starredOnly || s.isFavorite);
  const filteredSlates = (slates ?? []).filter(matches);
  const starred = filteredSlates.filter((s) => s.isFavorite);
  const rest = starredOnly ? [] : filteredSlates.filter((s) => !s.isFavorite);
  const filteredShared = (sharedSlates ?? []).filter(matches);
  const filteredSharedByMe = (sharedByMeSlates ?? []).filter(matches);
  const totalSharedCount = (sharedSlates?.length || 0) + (sharedByMeSlates?.length || 0);

  // Who is on the boards in view right now (refreshes as collaborators come and go).
  const visibleIds = activeTab === "recent" ? filteredSlates.map((s) => s._id).slice(0, 40) : [];
  const presence = useQuery(api.presence.activeOnSlates, visibleIds.length ? { slateIds: visibleIds } : "skip");
  const peopleBySlate = React.useMemo(() => {
    const map = new Map<string, CardPerson[]>();
    for (const p of presence ?? []) map.set(p.slateId, p.people);
    return map;
  }, [presence]);

  return (
    <div className="flex h-screen w-screen select-none overflow-hidden bg-[#09090b] font-sans text-white selection:bg-indigo-500/30">
      <CommandPalette open={isCommandOpen} onOpenChange={setIsCommandOpen} onNewSlate={requestNewBoard} onGoDashboard={() => setActiveTab("recent")} onAiGenerate={() => {}} />
      <PricingModal open={pricing.open} onOpenChange={(open) => setPricing((p) => ({ ...p, open }))} reason={pricing.reason} />
      <InviteDialog open={isInviteOpen} onOpenChange={setIsInviteOpen} workspace={activeWorkspace ? { id: activeWorkspace._id, name: activeWorkspace.name } : null} />

      {/* SIDEBAR */}
      <aside className="flex h-full w-64 shrink-0 flex-col justify-between border-r border-white/[0.06] bg-[#09090b] p-3">
        <div className="space-y-5">
          <div className="flex items-center justify-between px-1.5 pt-1">
            <Link href="/" className="flex items-center gap-2" aria-label="Slate home">
              <Image src="/logo.svg" alt="" width={24} height={24} className="rounded-md" />
              <span className="text-[13px] font-bold tracking-tight">Slate</span>
            </Link>
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-1 text-[10.5px] font-medium text-zinc-500 transition-colors hover:text-zinc-200"
              title="Search & quick actions"
            >
              <Command className="h-3 w-3" /> K
            </button>
          </div>

          <WorkspaceSwitcher
            workspaces={workspaces as SwitcherWorkspace[] | undefined}
            activeId={activeWorkspaceId}
            fallbackName={user?.fullName ? `${user.fullName}'s Slate` : "Slate Workspace"}
            onSelect={(id) => {
              setActiveWorkspaceId(id as Id<"workspaces">);
              setActiveTab("recent");
            }}
            onCreate={() => setIsCreateWorkspaceOpen(true)}
            onSettings={() => setActiveTab("settings")}
            onInvite={() => setIsInviteOpen(true)}
          />

          <nav className="space-y-0.5 pl-2" aria-label="Dashboard">
            <NavButton active={activeTab === "recent"} onClick={() => setActiveTab("recent")} icon={Clock}>
              Slates
            </NavButton>
            <NavButton active={activeTab === "shared"} onClick={() => setActiveTab("shared")} icon={Share2} badge={totalSharedCount}>
              Shared Slates
            </NavButton>
            <NavButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")} icon={Settings}>
              Settings &amp; Members
            </NavButton>
          </nav>
        </div>

        <div className="space-y-3">
          <UsageMeter billing={billing} onUpgrade={() => openPricing(null)} />
          <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-1.5 pt-3">
            <UserButton />
            <p className="truncate text-[12.5px] font-medium text-zinc-200">{user?.fullName || "Developer"}</p>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex h-full flex-1 flex-col overflow-hidden bg-[#09090b]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-8">
          <h1 className="text-[13px] font-semibold tracking-tight text-white">
            {activeTab === "recent" && (activeWorkspace?.name ?? "Slates")}
            {activeTab === "shared" && "Shared Slates"}
            {activeTab === "settings" && "Workspace Settings"}
          </h1>
          {activeTab !== "settings" && (
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filter boards…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Filter boards"
                  className="h-9 w-56 rounded-lg border border-white/[0.08] bg-[#121215] pl-9 pr-3 text-[12.5px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400/60"
                />
              </div>
              <button
                type="button"
                aria-pressed={starredOnly}
                onClick={() => setStarredOnly((v) => !v)}
                className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${starredOnly ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:text-white"}`}
              >
                <Star className={`h-3.5 w-3.5 ${starredOnly ? "fill-amber-300" : ""}`} /> Starred
              </button>
              {activeTab === "recent" && (
                <Button onClick={requestNewBoard} className="h-9 cursor-pointer gap-1.5 rounded-lg bg-white px-3.5 text-[12.5px] font-semibold text-black shadow-sm hover:bg-zinc-200">
                  <Plus className="h-4 w-4" /> New Board
                </Button>
              )}
            </div>
          )}
        </header>

        {notice && (
          <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-red-500/20 bg-red-500/[0.07] px-8 py-2 text-[12.5px] text-red-200">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer rounded p-0.5 hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {pendingInvites && pendingInvites.length > 0 && (
          <div className="shrink-0 space-y-2 border-b border-amber-500/15 bg-amber-500/[0.04] px-8 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">Pending workspace invitations</span>
            </div>
            {pendingInvites.map((invite) => (
              <div key={invite._id} className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Briefcase className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-white">{invite.workspaceName || "Unknown Workspace"}</p>
                    <p className="text-[11px] text-zinc-500">
                      Invited as <span className="font-semibold text-amber-400">{invite.role}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleInviteResponse(invite._id, true)}
                    disabled={respondingId === invite._id}
                    className="flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    {respondingId === invite._id ? "…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInviteResponse(invite._id, false)}
                    disabled={respondingId === invite._id}
                    className="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-500/30 bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-rose-400 transition-colors hover:bg-rose-950 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-8 py-6 [scrollbar-width:thin]">
          {activeTab === "recent" && (
            <div className="space-y-8">
              <TemplateRail onPick={handleTemplate} busyId={templateBusy} disabled={!activeWorkspaceId} />

              {slates === undefined && activeWorkspaceId ? (
                <div className={grid} aria-label="Loading boards">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[268px] animate-pulse rounded-2xl border border-white/[0.05] bg-[#121215]" />
                  ))}
                </div>
              ) : filteredSlates.length === 0 ? (
                <div className={`space-y-3 rounded-2xl p-14 text-center ${surface}`}>
                  <h4 className="text-sm font-semibold text-white">{q || starredOnly ? "No boards match" : "No boards yet"}</h4>
                  <p className="text-xs text-zinc-500">{q || starredOnly ? "Try another search, or clear the filters." : "Pick a template above, or start from a blank canvas."}</p>
                  {!q && !starredOnly && (
                    <Button onClick={requestNewBoard} className="rounded-lg bg-white text-black hover:bg-zinc-200">
                      Create a board
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {starred.length > 0 && (
                    <section>
                      <SectionTitle icon={Star} count={starred.length}>
                        Starred
                      </SectionTitle>
                      <div className={grid}>
                        {starred.map((s) => (
                          <BoardCard key={s._id} slate={s} people={peopleBySlate.get(s._id)} onToggleFavorite={toggleFavorite} onRename={rename} onDelete={remove} />
                        ))}
                      </div>
                    </section>
                  )}
                  {rest.length > 0 && (
                    <section>
                      <SectionTitle count={rest.length}>{starred.length > 0 ? "All boards" : "Boards"}</SectionTitle>
                      <div className={grid}>
                        {rest.map((s) => (
                          <BoardCard key={s._id} slate={s} people={peopleBySlate.get(s._id)} onToggleFavorite={toggleFavorite} onRename={rename} onDelete={remove} />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "shared" && (
            <div className="space-y-10">
              <section>
                <SectionTitle icon={Users}>Shared with me</SectionTitle>
                {filteredShared.length === 0 ? (
                  <p className="py-4 text-xs text-zinc-600">No slates have been shared with you yet.</p>
                ) : (
                  <div className={grid}>
                    {filteredShared.map((s) => (
                      <BoardCard
                        key={s._id}
                        slate={{ ...s, workspaceName: s.workspaceName }}
                        onToggleFavorite={toggleFavorite}
                        footer={
                          s.sharedBy ? (
                            <div className="flex items-center gap-2 border-t border-white/[0.05] px-3.5 py-2.5">
                              {s.sharedBy.avatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={s.sharedBy.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full border border-white/10 object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[9px] font-bold">{s.sharedBy.name?.charAt(0) || "?"}</span>
                              )}
                              <p className="min-w-0 truncate text-[11px] text-zinc-500">
                                Shared by <span className="font-medium text-zinc-300">{s.sharedBy.name}</span>
                              </p>
                            </div>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="border-t border-white/[0.06] pt-8">
                <SectionTitle icon={Share2}>Shared by me</SectionTitle>
                {filteredSharedByMe.length === 0 ? (
                  <p className="py-4 text-xs text-zinc-600">You haven&apos;t shared any slates yet. Use the Share button inside a slate to invite members.</p>
                ) : (
                  <div className={grid}>
                    {filteredSharedByMe.map((s) => (
                      <BoardCard
                        key={s._id}
                        slate={s}
                        onToggleFavorite={toggleFavorite}
                        footer={
                          s.sharedWith.length > 0 ? (
                            <div className="flex items-center gap-2 border-t border-white/[0.05] px-3.5 py-2.5">
                              <span className="flex -space-x-1.5">
                                {s.sharedWith.slice(0, 4).map((p, i) =>
                                  p.avatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={i} src={p.avatar} alt="" className="h-5 w-5 rounded-full border border-[#121215] object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <span key={i} className="flex h-5 w-5 items-center justify-center rounded-full border border-[#121215] bg-zinc-700 text-[9px] font-bold">
                                      {p.name?.charAt(0) || "?"}
                                    </span>
                                  )
                                )}
                              </span>
                              <p className="text-[11px] text-zinc-500">
                                Shared with {s.sharedWith.length} {s.sharedWith.length === 1 ? "person" : "people"}
                              </p>
                            </div>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "settings" && <WorkspaceSettings workspace={activeWorkspace} billing={billing} onInvite={() => setIsInviteOpen(true)} onUpgrade={() => openPricing(null)} />}
        </div>
      </main>

      {/* CREATE SLATE */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md rounded-2xl border border-white/10 bg-[#121215] p-6 text-white">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-base font-semibold">Create Slate</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSlate} className="space-y-4">
            <input
              required
              autoFocus
              type="text"
              placeholder="Title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 text-[13px] text-white outline-none focus:border-indigo-400/60"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={isCreating} className="h-10 gap-2 bg-white px-5 text-xs text-black hover:bg-zinc-200">
                {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {isCreating ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE WORKSPACE */}
      <Dialog open={isCreateWorkspaceOpen} onOpenChange={setIsCreateWorkspaceOpen}>
        <DialogContent className="max-w-md rounded-2xl border border-white/10 bg-[#121215] p-6 text-white">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-base font-semibold">New Workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <input
              required
              autoFocus
              type="text"
              placeholder="Workspace name"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 text-[13px] text-white outline-none focus:border-indigo-400/60"
            />
            <div className="flex justify-end">
              <Button type="submit" className="h-10 bg-white px-5 text-xs text-black hover:bg-zinc-200">
                Create Workspace
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
