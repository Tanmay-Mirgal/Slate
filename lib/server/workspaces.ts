import { z } from "zod";
import { getCollections, newDocId } from "@/lib/db/mongo";
import type { InviteDoc, Role, WorkspaceDoc } from "@/lib/db/types";
import { effectiveTier } from "@/lib/billing/limits";
import { AppError, mutation, query, zId, zRole, type Ctx } from "./fn";
import { membershipOf } from "./access";
import { displayName } from "./profile";

const MAX_WORKSPACE_NAME = 60;

const requireUser = (ctx: Ctx): string => {
  if (!ctx.userId) throw new AppError("Unauthenticated");
  return ctx.userId;
};

export const create = mutation({
  args: z.object({ name: z.string().trim().min(1, "Give the workspace a name").max(MAX_WORKSPACE_NAME) }),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const c = await getCollections();
    const now = Date.now();
    const doc: WorkspaceDoc = { _id: newDocId(), name: args.name, ownerId: userId, createdAt: now, updatedAt: now };
    await c.workspaces.insertOne(doc);
    await c.workspaceMembers.insertOne({ _id: newDocId(), workspaceId: doc._id, userId, role: "Admin", addedAt: now });
    return doc._id;
  },
});

export const renameWorkspace = mutation({
  args: z.object({ id: zId, name: z.string().trim().min(1).max(MAX_WORKSPACE_NAME) }),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const membership = await membershipOf(args.id, userId);
    if (!membership || membership.role !== "Admin") throw new AppError("Unauthorized");
    const c = await getCollections();
    await c.workspaces.updateOne({ _id: args.id }, { $set: { name: args.name, updatedAt: Date.now() } });
    return args.id;
  },
});

export const listMyWorkspaces = query({
  handler: async (ctx) => {
    if (!ctx.userId) return [];
    const c = await getCollections();
    const memberships = await c.workspaceMembers.find({ userId: ctx.userId }).sort({ addedAt: 1 }).limit(200).toArray();
    if (memberships.length === 0) return [];
    const ids = memberships.map((m) => m.workspaceId);
    const workspaces = await c.workspaces.find({ _id: { $in: ids } }).toArray();
    const byId = new Map(workspaces.map((w) => [w._id, w]));

    const counts = await c.workspaceMembers
      .aggregate<{ _id: string; n: number }>([{ $match: { workspaceId: { $in: ids } } }, { $group: { _id: "$workspaceId", n: { $sum: 1 } } }])
      .toArray();
    const memberCount = new Map(counts.map((r) => [r._id, r.n]));

    // The owner's plan is the workspace's plan.
    const owners = await c.users.find({ clerkId: { $in: Array.from(new Set(workspaces.map((w) => w.ownerId))) } }).toArray();
    const now = Date.now();
    const planOf = new Map(owners.map((u) => [u.clerkId, effectiveTier(u, now)]));

    const out = [];
    for (const m of memberships) {
      const workspace = byId.get(m.workspaceId);
      if (!workspace) continue;
      out.push({ ...workspace, role: m.role, memberCount: Math.min(200, memberCount.get(workspace._id) ?? 1), plan: planOf.get(workspace.ownerId) ?? ("free" as const) });
    }
    return out;
  },
});

export const getWorkspace = query({
  args: z.object({ id: zId }),
  handler: async (ctx, args) => {
    if (!ctx.userId) return null;
    const membership = await membershipOf(args.id, ctx.userId);
    if (!membership) return null;
    const c = await getCollections();
    const workspace = await c.workspaces.findOne({ _id: args.id });
    return workspace ? { ...workspace, role: membership.role } : null;
  },
});

/** Members of a workspace with their profile, visible to every member. */
export const listMembers = query({
  args: z.object({ workspaceId: zId }),
  handler: async (ctx, args) => {
    if (!ctx.userId) return [];
    if (!(await membershipOf(args.workspaceId, ctx.userId))) return [];
    const c = await getCollections();
    const workspace = await c.workspaces.findOne({ _id: args.workspaceId });
    const rows = await c.workspaceMembers.find({ workspaceId: args.workspaceId }).limit(200).toArray();
    const users = await c.users.find({ clerkId: { $in: rows.map((r) => r.userId) } }).toArray();
    const byId = new Map(users.map((u) => [u.clerkId, u]));
    const members = rows.map((m) => {
      const user = byId.get(m.userId);
      return {
        userId: m.userId,
        role: m.role,
        isOwner: workspace?.ownerId === m.userId,
        isYou: m.userId === ctx.userId,
        name: user ? displayName(user, user.email) : "Member",
        email: user?.email || null,
        avatar: user?.imageUrl ?? null,
      };
    });
    return members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
  },
});

/** Pending invitations of a workspace, visible to its members. */
export const listPendingInvites = query({
  args: z.object({ workspaceId: zId }),
  handler: async (ctx, args) => {
    if (!ctx.userId) return [];
    if (!(await membershipOf(args.workspaceId, ctx.userId))) return [];
    const c = await getCollections();
    const invites = await c.invites.find({ workspaceId: args.workspaceId, status: "pending" }).sort({ createdAt: 1 }).limit(100).toArray();
    return invites.map((i) => ({ _id: i._id, email: i.recipientEmail, role: i.role, createdAt: i.createdAt }));
  },
});

export const createInvite = mutation({
  args: z.object({ workspaceId: zId, recipientEmail: z.string().trim().email().max(254), role: zRole }),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const membership = await membershipOf(args.workspaceId, userId);
    if (!membership || membership.role !== "Admin") throw new AppError("Unauthorized");

    const c = await getCollections();
    const recipientEmail = args.recipientEmail.toLowerCase();
    // inviting the same address again updates the open invitation instead of piling up duplicates
    const open = await c.invites.findOneAndUpdate(
      { workspaceId: args.workspaceId, recipientEmail, status: "pending" },
      { $set: { role: args.role, inviterId: userId } },
      { returnDocument: "after" }
    );
    if (open) return open._id;
    const doc: InviteDoc = { _id: newDocId(), workspaceId: args.workspaceId, inviterId: userId, recipientEmail, role: args.role, status: "pending", createdAt: Date.now() };
    await c.invites.insertOne(doc);
    return doc._id;
  },
});

/** Every address the caller can be invited at (their verified emails). */
async function myEmails(ctx: Ctx): Promise<string[]> {
  const user = await ctx.profile();
  if (!user) return [];
  return Array.from(new Set([user.email, ...(user.emails ?? [])].map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

export const getMyPendingInvites = query({
  handler: async (ctx) => {
    if (!ctx.userId) return [];
    const emails = await myEmails(ctx);
    if (emails.length === 0) return [];
    const c = await getCollections();
    const invites = await c.invites.find({ recipientEmail: { $in: emails }, status: "pending" }).sort({ createdAt: 1 }).limit(100).toArray();
    const workspaces = await c.workspaces.find({ _id: { $in: invites.map((i) => i.workspaceId) } }).toArray();
    const names = new Map(workspaces.map((w) => [w._id, w.name]));
    return invites.map((inv) => ({ ...inv, workspaceName: names.get(inv.workspaceId) as string | undefined }));
  },
});

export const respondToInvite = mutation({
  args: z.object({ inviteId: zId, accept: z.boolean() }),
  handler: async (ctx, args) => {
    const userId = requireUser(ctx);
    const emails = await myEmails(ctx);
    if (emails.length === 0) throw new AppError("No email found");

    const c = await getCollections();
    // claim the invitation atomically so a double click can't add the member twice
    const invite = await c.invites.findOneAndUpdate(
      { _id: args.inviteId, recipientEmail: { $in: emails }, status: "pending" },
      { $set: { status: args.accept ? "accepted" : "rejected" } },
      { returnDocument: "before" }
    );
    if (!invite) throw new AppError("Invalid invite");

    if (args.accept) {
      await c.workspaceMembers.updateOne(
        { workspaceId: invite.workspaceId, userId },
        { $setOnInsert: { _id: newDocId(), role: invite.role as Role, addedAt: Date.now() } },
        { upsert: true }
      );
    }
    return { success: true };
  },
});
