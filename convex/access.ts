import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;
export type Role = "Admin" | "Editor" | "Viewer";

export interface Access {
  level: "edit" | "view";
  role: Role | null;
  /** Clerk subject, or null for anonymous visitors. */
  userId: string | null;
  via: "member" | "owner" | "link";
}

/**
 * Single source of truth for "who can do what" on a slate.
 *
 *  - Workspace Admin / Editor  -> edit
 *  - Workspace Viewer          -> view
 *  - Legacy slates (no workspace) -> their original owner edits
 *  - Link sharing ("Anyone with the link"):
 *        "view" -> anyone, signed in or not, can view
 *        "edit" -> signed-in users can edit, anonymous visitors can view
 *
 * Returns null when the caller has no access at all.
 */
export async function resolveAccess(ctx: Ctx, slate: Doc<"slates">): Promise<Access | null> {
  const identity = await ctx.auth.getUserIdentity();
  const userId = identity?.subject ?? null;

  if (userId) {
    if (slate.workspaceId) {
      const membership = await ctx.db
        .query("workspace_members")
        .withIndex("by_workspaceId_userId", (q) => q.eq("workspaceId", slate.workspaceId!).eq("userId", userId))
        .unique();
      if (membership) {
        return {
          level: membership.role === "Viewer" ? "view" : "edit",
          role: membership.role,
          userId,
          via: "member",
        };
      }
    } else if (slate.userId === userId) {
      return { level: "edit", role: "Admin", userId, via: "owner" };
    }
  }

  const link = slate.linkAccess ?? "none";
  if (link === "edit" && userId) return { level: "edit", role: null, userId, via: "link" };
  if (link === "edit" || link === "view") return { level: "view", role: null, userId, via: "link" };
  return null;
}

export async function loadSlate(ctx: Ctx, id: Id<"slates">): Promise<Doc<"slates"> | null> {
  const slate = await ctx.db.get(id);
  if (!slate || slate.isArchived) return null;
  return slate;
}

export async function requireView(ctx: Ctx, id: Id<"slates">): Promise<{ slate: Doc<"slates">; access: Access }> {
  const slate = await loadSlate(ctx, id);
  if (!slate) throw new Error("Slate not found");
  const access = await resolveAccess(ctx, slate);
  if (!access) throw new Error("You don't have access to this slate");
  return { slate, access };
}

export async function requireEdit(ctx: Ctx, id: Id<"slates">): Promise<{ slate: Doc<"slates">; access: Access }> {
  const res = await requireView(ctx, id);
  if (res.access.level !== "edit") throw new Error("You only have view access to this slate");
  return res;
}

/**
 * Collaboration rules that sit on top of view / edit:
 *
 *  - Reading comments        anyone who can view the slate (so a shared link shows the discussion)
 *  - Writing comments        signed in AND (workspace member of ANY role, legacy owner, or a link that
 *                            grants edit). Workspace Viewers can therefore review and comment; people who
 *                            only hold a "view" link cannot, so a public link is never a write surface.
 *  - Deleting others' comments   members with edit rights (the same people who can rename / delete the slate)
 *  - Version history         members of any role. Link visitors never see it: old versions can contain
 *                            content that was deliberately removed from the board.
 */
export function canComment(access: Access): boolean {
  return !!access.userId && (access.via !== "link" || access.level === "edit");
}

export function canModerate(access: Access): boolean {
  return access.via !== "link" && access.level === "edit";
}

export function canViewHistory(access: Access): boolean {
  return access.via !== "link";
}

export async function requireComment(ctx: Ctx, id: Id<"slates">): Promise<{ slate: Doc<"slates">; access: Access & { userId: string } }> {
  const { slate, access } = await requireView(ctx, id);
  if (!access.userId) throw new Error("Sign in to comment");
  if (!canComment(access)) throw new Error("You only have view access to this slate, so you can't comment");
  return { slate, access: { ...access, userId: access.userId } };
}

export async function requireHistory(ctx: Ctx, id: Id<"slates">): Promise<{ slate: Doc<"slates">; access: Access }> {
  const res = await requireView(ctx, id);
  if (!canViewHistory(res.access)) throw new Error("Only workspace members can see version history");
  return res;
}

/** Edit rights via workspace membership / ownership (not just a shared link): rename, delete, share settings. */
export async function requireManage(ctx: Ctx, id: Id<"slates">): Promise<{ slate: Doc<"slates">; access: Access }> {
  const res = await requireEdit(ctx, id);
  if (res.access.via === "link") throw new Error("Only workspace members can change this slate");
  return res;
}
