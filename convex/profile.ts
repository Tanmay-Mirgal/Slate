import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

export interface Profile {
  userId: string;
  name: string;
  avatar?: string;
}

const MAX_NAME = 80;

/** First name + last name, else the part of the email before the "@" (never the full address), else "Someone". */
export function displayName(user: Pick<Doc<"users">, "firstName" | "lastName" | "email"> | null, fallback?: string | null): string {
  const full = user ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() : "";
  if (full) return full.slice(0, MAX_NAME);
  if (fallback && fallback.trim()) return fallback.trim().slice(0, MAX_NAME);
  const local = user?.email?.split("@")[0]?.trim();
  return (local || "Someone").slice(0, MAX_NAME);
}

/**
 * Public-facing identity of a signed-in user (name + avatar, never the email). Prefers the synced
 * `users` row, falls back to what the auth token carries.
 */
export async function profileOf(ctx: Ctx, userId: string, tokenName?: string | null, tokenPicture?: string | null): Promise<Profile> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
    .unique();
  const avatar = user?.imageUrl ?? tokenPicture ?? undefined;
  return { userId, name: displayName(user, tokenName), avatar: avatar && avatar.length < 500 ? avatar : undefined };
}

/** Everyone who belongs to the slate's workspace (or its legacy owner), for @mentions. */
export async function slateMembers(ctx: Ctx, slate: Doc<"slates">): Promise<Profile[]> {
  const ids: string[] = [];
  if (slate.workspaceId) {
    const rows = await ctx.db
      .query("workspace_members")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", slate.workspaceId!))
      .take(100);
    for (const r of rows) ids.push(r.userId);
  } else if (slate.userId) {
    ids.push(slate.userId);
  }
  const out: Profile[] = [];
  for (const id of ids) out.push(await profileOf(ctx, id));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
