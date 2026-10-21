import { getCollections } from "@/lib/db/mongo";
import type { Id, Role, SlateDoc } from "@/lib/db/types";
import { AppError, type Ctx } from "./fn";

export type { Role };

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
export async function resolveAccess(ctx: Ctx, slate: Pick<SlateDoc, "workspaceId" | "userId" | "linkAccess">): Promise<Access | null> {
  const userId = ctx.userId;

  if (userId) {
    if (slate.workspaceId) {
      const c = await getCollections();
      const membership = await c.workspaceMembers.findOne({ workspaceId: slate.workspaceId, userId });
      if (membership) {
        return { level: membership.role === "Viewer" ? "view" : "edit", role: membership.role, userId, via: "member" };
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

/** Fields access checks and housekeeping need. The document bodies stay out so hot paths never load them. */
const LIGHT = { documentText: 0, documentJson: 0, elements: 0 } as const;

/** A slate that exists and is not archived, without its (large) document / legacy canvas fields. */
export async function loadSlate(id: Id<"slates">): Promise<SlateDoc | null> {
  const c = await getCollections();
  const slate = await c.slates.findOne({ _id: id }, { projection: LIGHT });
  if (!slate || slate.isArchived) return null;
  return slate;
}

export async function requireView(ctx: Ctx, id: Id<"slates">): Promise<{ slate: SlateDoc; access: Access }> {
  const slate = await loadSlate(id);
  if (!slate) throw new AppError("Slate not found");
  const access = await resolveAccess(ctx, slate);
  if (!access) throw new AppError("You don't have access to this slate");
  return { slate, access };
}

export async function requireEdit(ctx: Ctx, id: Id<"slates">): Promise<{ slate: SlateDoc; access: Access }> {
  const res = await requireView(ctx, id);
  if (res.access.level !== "edit") throw new AppError("You only have view access to this slate");
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

export async function requireComment(ctx: Ctx, id: Id<"slates">): Promise<{ slate: SlateDoc; access: Access & { userId: string } }> {
  const { slate, access } = await requireView(ctx, id);
  if (!access.userId) throw new AppError("Sign in to comment");
  if (!canComment(access)) throw new AppError("You only have view access to this slate, so you can't comment");
  return { slate, access: { ...access, userId: access.userId } };
}

export async function requireHistory(ctx: Ctx, id: Id<"slates">): Promise<{ slate: SlateDoc; access: Access }> {
  const res = await requireView(ctx, id);
  if (!canViewHistory(res.access)) throw new AppError("Only workspace members can see version history");
  return res;
}

/** Edit rights via workspace membership / ownership (not just a shared link): rename, delete, share settings. */
export async function requireManage(ctx: Ctx, id: Id<"slates">): Promise<{ slate: SlateDoc; access: Access }> {
  const res = await requireEdit(ctx, id);
  if (res.access.via === "link") throw new AppError("Only workspace members can change this slate");
  return res;
}

/** The caller's membership in a workspace, if any. */
export async function membershipOf(workspaceId: Id<"workspaces">, userId: string) {
  const c = await getCollections();
  return await c.workspaceMembers.findOne({ workspaceId, userId });
}
