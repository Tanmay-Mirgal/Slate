import { z } from "zod";
import { recentAudit } from "@/lib/connector/audit";
import { connectorConfig, connectorEnabled } from "@/lib/connector/config";
import { revokeGrant } from "@/lib/connector/oauth/grants";
import { getCollections } from "@/lib/db/mongo";
import { membershipOf } from "./access";
import { AppError, mutation, query, zId } from "./fn";
import { displayName } from "./profile";

/*
 * The "Connected apps" panel of the workspace settings. These are the only connector functions the browser can
 * reach (through /api/rpc, with the Clerk session): the connector API itself is bearer-token only.
 * With the connector switched off they answer "nothing here" and the panel does not render.
 */

const hubNameOrNull = (): string | null => {
  if (!connectorEnabled()) return null;
  try {
    return connectorConfig().hubName;
  } catch {
    return null; // misconfigured: the boot check reports it; the settings page just hides the panel
  }
};

/**
 * Active connections of a workspace, their webhook health and the last 20 audited calls. Admins see every
 * connection of the workspace; other members see their own.
 */
export const overview = query({
  args: z.object({ workspaceId: zId }),
  handler: async (ctx, args) => {
    const hubName = hubNameOrNull();
    if (!hubName || !ctx.userId) return null;
    const membership = await membershipOf(args.workspaceId, ctx.userId);
    if (!membership) return null;
    const seesAll = membership.role === "Admin";

    const c = await getCollections();
    const grants = await c.connectorGrants
      .find({ workspaceId: args.workspaceId, revokedAt: { $exists: false }, ...(seesAll ? {} : { userId: ctx.userId }) })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    const grantIds = grants.map((g) => g._id);

    const [users, hooks, audit] = await Promise.all([
      c.users.find({ clerkId: { $in: Array.from(new Set(grants.map((g) => g.userId))) } }).toArray(),
      grantIds.length ? c.connectorWebhooks.find({ grantId: { $in: grantIds } }).sort({ createdAt: 1 }).limit(200).toArray() : [],
      recentAudit(args.workspaceId, 100),
    ]);
    const nameOf = new Map(users.map((u) => [u.clerkId, displayName(u)]));
    const visible = new Set(grantIds);

    return {
      hubName,
      seesAll,
      grants: grants.map((g) => ({
        id: g._id,
        clientName: hubName,
        scopes: g.scopes,
        connectedBy: { name: nameOf.get(g.userId) ?? "Someone", isYou: g.userId === ctx.userId },
        createdAt: g.createdAt,
        lastUsedAt: g.lastUsedAt ?? null,
        webhooks: hooks
          .filter((h) => h.grantId === g._id)
          .map((h) => ({
            id: h._id,
            host: (() => {
              try {
                return new URL(h.url).host;
              } catch {
                return h.url;
              }
            })(),
            status: h.status,
            disabledReason: h.disabledReason ?? null,
            lastDeliveryStatus: h.lastDeliveryStatus ?? null,
            lastDeliveryAt: h.lastDeliveryAt ?? null,
          })),
      })),
      activity: audit
        .filter((a) => visible.has(a.grantId))
        .slice(0, 20)
        .map((a) => ({ id: a._id, at: a.at, method: a.method, route: a.route, status: a.status })),
    };
  },
});

/** Disconnects an app at once. Its owner can do it, and so can any Admin of the workspace. */
export const revoke = mutation({
  args: z.object({ grantId: zId }),
  handler: async (ctx, args) => {
    if (!connectorEnabled()) throw new AppError("Connected apps are not available");
    if (!ctx.userId) throw new AppError("Unauthenticated");
    const c = await getCollections();
    const grant = await c.connectorGrants.findOne({ _id: args.grantId, revokedAt: { $exists: false } });
    if (!grant) throw new AppError("That connection no longer exists");
    const membership = await membershipOf(grant.workspaceId, ctx.userId);
    if (!membership || (grant.userId !== ctx.userId && membership.role !== "Admin")) throw new AppError("Unauthorized");
    await revokeGrant(grant._id, "revoked_by_user");
    return args.grantId;
  },
});
