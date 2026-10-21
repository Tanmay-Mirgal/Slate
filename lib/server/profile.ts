import { getCollections } from "@/lib/db/mongo";
import type { SlateDoc, UserDoc } from "@/lib/db/types";

export interface Profile {
  userId: string;
  name: string;
  avatar?: string;
}

const MAX_NAME = 80;

/** First name + last name, else the part of the email before the "@" (never the full address), else "Someone". */
export function displayName(user: Pick<UserDoc, "firstName" | "lastName" | "email"> | null, fallback?: string | null): string {
  const full = user ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() : "";
  if (full) return full.slice(0, MAX_NAME);
  if (fallback && fallback.trim()) return fallback.trim().slice(0, MAX_NAME);
  const local = user?.email?.split("@")[0]?.trim();
  return (local || "Someone").slice(0, MAX_NAME);
}

/** Public-facing identity (name + avatar, never the email) of a stored user. */
export function toProfile(userId: string, user: UserDoc | null): Profile {
  const avatar = user?.imageUrl ?? undefined;
  return { userId, name: displayName(user), avatar: avatar && avatar.length < 500 ? avatar : undefined };
}

/** Public-facing identity of any user id, from the synced `users` collection. */
export async function profileOf(userId: string): Promise<Profile> {
  const c = await getCollections();
  return toProfile(userId, await c.users.findOne({ clerkId: userId }));
}

/** Everyone who belongs to the slate's workspace (or its legacy owner), for @mentions. */
export async function slateMembers(slate: Pick<SlateDoc, "workspaceId" | "userId">): Promise<Profile[]> {
  const c = await getCollections();
  let ids: string[] = [];
  if (slate.workspaceId) {
    const rows = await c.workspaceMembers.find({ workspaceId: slate.workspaceId }).limit(100).toArray();
    ids = rows.map((r) => r.userId);
  } else if (slate.userId) {
    ids = [slate.userId];
  }
  const users = ids.length ? await c.users.find({ clerkId: { $in: ids } }).toArray() : [];
  const byId = new Map(users.map((u) => [u.clerkId, u]));
  return ids.map((id) => toProfile(id, byId.get(id) ?? null)).sort((a, b) => a.name.localeCompare(b.name));
}
