import { effectiveTier, limitsFor, checkAiCredit } from "@/lib/billing/limits";
import { PLANS } from "@/lib/billing/plans";
import { nvidiaConfig } from "@/lib/ai/nvidia";
import { getCollections } from "@/lib/db/mongo";
import { countOwnedBoards } from "@/lib/server/billing";
import { displayName } from "@/lib/server/profile";
import { ensureUser } from "@/lib/server/users";
import type { AuthedGrant } from "../auth/verify";

/**
 * `GET /me`: who the connection acts as and what it can do right now.
 *
 * Boards are capped by the plan of the workspace OWNER (a Team workspace can be filled by its members), while AI
 * credits come out of the CONNECTED USER's own balance, exactly as in the app. So `plan` describes the workspace
 * and `capabilities.aiCreditsRemaining` the person.
 */
export async function buildMe(grant: AuthedGrant) {
  const c = await getCollections();
  const [workspace, user] = await Promise.all([c.workspaces.findOne({ _id: grant.workspaceId }), ensureUser(grant.userId)]);
  const ownerId = workspace?.ownerId ?? grant.userId;
  const owner = ownerId === grant.userId ? user : await c.users.findOne({ clerkId: ownerId });
  const now = Date.now();

  const workspaceTier = effectiveTier(owner, now);
  const boardLimit = limitsFor(workspaceTier).maxBoards;
  const boardsUsed = boardLimit === null ? null : await countOwnedBoards(ownerId, boardLimit + 1);

  const userTier = effectiveTier(user, now);
  const credits = checkAiCredit(userTier, user, now);

  return {
    user: { id: grant.userId, email: user.email, name: displayName(user) },
    tenant: { id: grant.workspaceId, name: workspace?.name ?? "Workspace", kind: "workspace" as const, role: grant.role },
    scopes: [...grant.effective],
    grantId: grant.grantId,
    plan: {
      name: PLANS[workspaceTier].name,
      limits: { maxBoards: boardLimit, aiCreditsMonthly: credits.cap },
      usage: { boards: boardsUsed, aiCredits: credits.used },
    },
    capabilities: {
      aiAvailable: !!nvidiaConfig().apiKey && grant.effective.has("slate:ai:generate"),
      aiCreditsRemaining: credits.remaining,
      boardsUsed,
      boardsCap: boardLimit,
    },
  };
}
