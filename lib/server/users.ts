import { getCollections, newDocId } from "@/lib/db/mongo";
import type { UserDoc, WorkspaceDoc } from "@/lib/db/types";
import { AppError, mutation, type Ctx } from "./fn";
import { displayName } from "./profile";

/**
 * Clerk is the source of truth for who a person is; MongoDB keeps a copy (name, avatar, email) so the
 * rest of the app can show teammates without calling Clerk. The copy is kept fresh three ways:
 *   1. the Clerk webhook (`/api/webhooks/clerk`) on user.created / updated / deleted
 *   2. lazily: the first request of a user Clerk told us nothing about creates their row (`ensureUser`)
 *   3. `npm run clerk:sync`, a backfill of every Clerk user
 */

export interface ProfileInput {
  email: string;
  emails: string[];
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

export type ProfileSource = (userId: string) => Promise<ProfileInput | null>;

interface ClerkLikeEmail {
  id: string;
  emailAddress: string;
  verification?: { status?: string | null } | null;
}

export interface ClerkLikeUser {
  primaryEmailAddressId?: string | null;
  emailAddresses: ClerkLikeEmail[];
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
}

const lower = (s: string) => s.trim().toLowerCase();

export function normalizeEmails(list: readonly string[]): string[] {
  return Array.from(new Set(list.map(lower).filter(Boolean)));
}

/** Maps a Clerk backend `User` to the fields we store. */
export function profileFromClerk(u: ClerkLikeUser): ProfileInput {
  const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0];
  const verified = u.emailAddresses.filter((e) => e.verification?.status === "verified").map((e) => e.emailAddress);
  const email = primary?.emailAddress ?? "";
  return {
    email,
    emails: normalizeEmails([...(email ? [email] : []), ...verified]),
    firstName: u.firstName || null,
    lastName: u.lastName || null,
    imageUrl: u.imageUrl || null,
  };
}

export interface WebhookUserData {
  primary_email_address_id?: string | null;
  email_addresses?: { id?: string; email_address?: string; verification?: { status?: string | null } | null }[];
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
}

/** Maps the payload of a Clerk `user.*` webhook event. */
export function profileFromWebhook(d: WebhookUserData): ProfileInput {
  return profileFromClerk({
    primaryEmailAddressId: d.primary_email_address_id,
    emailAddresses: (d.email_addresses ?? []).map((e, i) => ({ id: e.id ?? String(i), emailAddress: e.email_address ?? "", verification: e.verification })),
    firstName: d.first_name,
    lastName: d.last_name,
    imageUrl: d.image_url,
  });
}

/** Creates or refreshes the stored copy of a Clerk user. Safe to call concurrently. */
export async function upsertUser(clerkId: string, p: ProfileInput): Promise<UserDoc> {
  const c = await getCollections();
  const now = Date.now();
  const update = {
    $set: { email: p.email, emails: normalizeEmails([p.email, ...p.emails]), firstName: p.firstName, lastName: p.lastName, imageUrl: p.imageUrl, updatedAt: now },
    $setOnInsert: { _id: newDocId(), createdAt: now },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await c.users.findOneAndUpdate({ clerkId }, update, { upsert: true, returnDocument: "after" });
      if (doc) return doc;
    } catch (e) {
      // two requests inserting the same new user at once: the loser just reads the winner's row
      if ((e as { code?: number }).code !== 11000 || attempt >= 2) throw e;
      const existing = await c.users.findOne({ clerkId });
      if (existing) return existing;
    }
  }
}

/** Removes a deleted Clerk user's row and the things that only make sense with them signed in. Content they created stays. */
export async function deleteUser(clerkId: string): Promise<void> {
  const c = await getCollections();
  await Promise.all([
    c.users.deleteOne({ clerkId }),
    c.workspaceMembers.deleteMany({ userId: clerkId }),
    c.slateFavorites.deleteMany({ userId: clerkId }),
    c.commentReads.deleteMany({ userId: clerkId }),
  ]);
}

/** Looks the user up in Clerk (backend API). Only reached when we have no usable row yet. */
export const clerkProfileSource: ProfileSource = async (userId) => {
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  return profileFromClerk(await client.users.getUser(userId));
};

/**
 * The stored profile of a signed-in user, created from Clerk on first sight. This is what makes a
 * brand-new account work even if the Clerk webhook is not configured or arrives late.
 */
export async function ensureUser(userId: string, source: ProfileSource = clerkProfileSource): Promise<UserDoc> {
  const c = await getCollections();
  const existing = await c.users.findOne({ clerkId: userId });
  if (existing && existing.email) return existing;
  try {
    const profile = await source(userId);
    if (profile) return await upsertUser(userId, profile);
  } catch (e) {
    console.error("[users] could not load the profile from Clerk:", e instanceof Error ? e.message : e);
  }
  // Clerk unreachable: a bare row still lets the person use the app; the next request tries Clerk again.
  return existing ?? (await upsertUser(userId, { email: "", emails: [], firstName: null, lastName: null, imageUrl: null }));
}

/* ------------------------------------------------------------------ first-run provisioning */

function workspaceNameFor(user: UserDoc | null): string {
  const full = user ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() : "";
  const name = full || user?.email?.split("@")[0]?.trim() || "My";
  return `${name.slice(0, 40)}'s Slate`;
}

/**
 * Every account owns at least one workspace, created the first time it signs in, so "New board" works
 * straight away. Idempotent: concurrent calls converge on a single workspace (unique partial index).
 */
export async function ensureDefaultWorkspace(userId: string, user: UserDoc | null): Promise<WorkspaceDoc> {
  const c = await getCollections();
  let workspace = await c.workspaces.findOne({ ownerId: userId }, { sort: { createdAt: 1 } });
  if (!workspace) {
    const now = Date.now();
    const doc: WorkspaceDoc = { _id: newDocId(), name: workspaceNameFor(user), ownerId: userId, isPersonal: true, createdAt: now, updatedAt: now };
    try {
      await c.workspaces.insertOne(doc);
      workspace = doc;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      workspace = await c.workspaces.findOne({ ownerId: userId }, { sort: { createdAt: 1 } });
      if (!workspace) throw e;
    }
  }
  // the owner is always an Admin member of their own workspace
  await c.workspaceMembers.updateOne({ workspaceId: workspace._id, userId }, { $setOnInsert: { _id: newDocId(), role: "Admin", addedAt: Date.now() } }, { upsert: true });
  return workspace;
}

/** Called by the dashboard on load (and by the Clerk webhook): makes sure the caller has a profile and a workspace. */
export const ensureProvisioned = mutation({
  handler: async (ctx: Ctx) => {
    if (!ctx.userId) throw new AppError("Unauthenticated");
    const user = await ctx.profile();
    const workspace = await ensureDefaultWorkspace(ctx.userId, user);
    return { workspaceId: workspace._id, name: user ? displayName(user) : null };
  },
});
