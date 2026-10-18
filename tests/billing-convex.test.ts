// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import schema from "@/convex/schema";

const modules = import.meta.glob(["../convex/**/*.{js,ts}", "!../convex/**/*.d.ts"]);

const SECRET = "test-billing-secret-0123456789";
const OWNER = { subject: "user_owner", email: "owner@example.com", name: "Owner" };
const MEMBER = { subject: "user_member", email: "member@example.com", name: "Member" };

beforeEach(() => {
  process.env.BILLING_SYNC_SECRET = SECRET;
});

async function setup() {
  const t = convexTest(schema, modules);
  const workspaceId = await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkId: OWNER.subject, email: OWNER.email, firstName: "Own", lastName: "Er", imageUrl: null });
    const id = await ctx.db.insert("workspaces", { name: "WS", ownerId: OWNER.subject, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("workspace_members", { workspaceId: id, userId: OWNER.subject, role: "Admin", addedAt: 1 });
    await ctx.db.insert("workspace_members", { workspaceId: id, userId: MEMBER.subject, role: "Editor", addedAt: 1 });
    return id;
  });
  return { t, workspaceId };
}

const activatePro = (t: ReturnType<typeof convexTest>, extra: Record<string, unknown> = {}) =>
  t.mutation(api.billing.syncSubscription, {
    secret: SECRET,
    clerkId: OWNER.subject,
    tier: "pro",
    status: "active",
    interval: "monthly",
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    resetCredits: true,
    ...extra,
  });

describe("syncSubscription", () => {
  it("is refused without the server secret", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.billing.syncSubscription, { secret: "wrong", clerkId: OWNER.subject, tier: "pro", status: "active" })).rejects.toThrow(/Invalid billing secret/);
    // a signed-in user can't grant themselves a plan either
    await expect(t.withIdentity(OWNER).mutation(api.billing.syncSubscription, { secret: "", clerkId: OWNER.subject, tier: "team", status: "active" })).rejects.toThrow();
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing?.tier).toBe("free");
  });

  it("activates a plan and refills credits", async () => {
    const { t } = await setup();
    const r = await activatePro(t, { razorpaySubscriptionId: "sub_1", razorpayPlanId: "plan_1" });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing).toMatchObject({ tier: "pro", status: "active", interval: "monthly", boards: { limit: null }, ai: { cap: 300, used: 0 } });
  });

  it("applies a webhook event once", async () => {
    const { t } = await setup();
    expect(await activatePro(t, { eventId: "evt_1", eventType: "subscription.activated" })).toMatchObject({ duplicate: false });
    await t.withIdentity(OWNER).mutation(api.billing.reserveAiCredit, {});
    // a retried delivery must not refill the credits the user just spent
    expect(await activatePro(t, { eventId: "evt_1", eventType: "subscription.activated" })).toMatchObject({ duplicate: true });
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing?.ai.used).toBe(1);
  });

  it("finds the user by subscription id when the notes are missing", async () => {
    const { t } = await setup();
    await activatePro(t, { razorpaySubscriptionId: "sub_find" });
    const r = await t.mutation(api.billing.syncSubscription, { secret: SECRET, razorpaySubscriptionId: "sub_find", tier: "pro", status: "cancelled", currentPeriodEnd: Date.now() + 1000 * 60 * 60 });
    expect(r).toMatchObject({ ok: true });
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing).toMatchObject({ tier: "pro", status: "cancelled", endsAtPeriodEnd: true });
  });

  it("reports an unknown user instead of inventing one", async () => {
    const { t } = await setup();
    expect(await t.mutation(api.billing.syncSubscription, { secret: SECRET, clerkId: "user_ghost", tier: "pro", status: "active" })).toEqual({ ok: false, reason: "user_not_found" });
  });

  it("drops to free once a cancelled plan's period has ended", async () => {
    const { t } = await setup();
    await activatePro(t, { status: "cancelled", currentPeriodEnd: Date.now() - 1000 });
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing?.tier).toBe("free");
  });
});

describe("AI credits", () => {
  it("lets a free user spend 15 credits and then refuses", async () => {
    const { t } = await setup();
    const as = t.withIdentity(OWNER);
    for (let i = 1; i <= 15; i++) {
      const r = await as.mutation(api.billing.reserveAiCredit, {});
      expect(r).toMatchObject({ ok: true, used: i, cap: 15 });
    }
    const refused = await as.mutation(api.billing.reserveAiCredit, {});
    expect(refused).toMatchObject({ ok: false, tier: "free", cap: 15, used: 15, remaining: 0 });
  });

  it("gives credits back only with the server secret", async () => {
    const { t } = await setup();
    const as = t.withIdentity(OWNER);
    await as.mutation(api.billing.reserveAiCredit, {});
    await as.mutation(api.billing.reserveAiCredit, {});
    await expect(as.mutation(api.billing.refundAiCredit, { secret: "nope", clerkId: OWNER.subject })).rejects.toThrow();
    await t.mutation(api.billing.refundAiCredit, { secret: SECRET, clerkId: OWNER.subject });
    expect((await as.query(api.billing.getMyBilling, {}))?.ai.used).toBe(1);
    await t.mutation(api.billing.refundAiCredit, { secret: SECRET, clerkId: OWNER.subject, cost: 5 });
    expect((await as.query(api.billing.getMyBilling, {}))?.ai.used).toBe(0);
  });

  it("creates the user row on first use and requires sign in", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.billing.reserveAiCredit, {})).rejects.toThrow(/Unauthenticated/);
    const newcomer = { subject: "user_new", email: "new@example.com", name: "New" };
    expect(await t.withIdentity(newcomer).mutation(api.billing.reserveAiCredit, {})).toMatchObject({ ok: true, used: 1 });
  });

  it("gives paid plans a bigger allowance", async () => {
    const { t } = await setup();
    await activatePro(t);
    const r = await t.withIdentity(OWNER).mutation(api.billing.reserveAiCredit, {});
    expect(r).toMatchObject({ ok: true, tier: "pro", cap: 300 });
  });
});

describe("board cap", () => {
  it("stops a free workspace owner at three boards, including boards teammates create", async () => {
    const { t, workspaceId } = await setup();
    const create = (who: typeof OWNER, title: string) => t.withIdentity(who).mutation(api.slates.create, { title, workspaceId, thumbnailIcon: "1" });
    await create(OWNER, "one");
    await create(MEMBER, "two");
    await create(OWNER, "three");
    await expect(create(MEMBER, "four")).rejects.toMatchObject({ data: { code: "board_limit", limit: 3, tier: "free" } });
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing?.boards).toEqual({ used: 3, limit: 3 });
  });

  it("frees a slot when a board is deleted", async () => {
    const { t, workspaceId } = await setup();
    const as = t.withIdentity(OWNER);
    const ids = [];
    for (const title of ["a", "b", "c"]) ids.push(await as.mutation(api.slates.create, { title, workspaceId, thumbnailIcon: "1" }));
    await expect(as.mutation(api.slates.create, { title: "d", workspaceId, thumbnailIcon: "1" })).rejects.toThrow();
    await as.mutation(api.slates.remove, { id: ids[0] });
    await expect(as.mutation(api.slates.create, { title: "d", workspaceId, thumbnailIcon: "1" })).resolves.toBeTruthy();
  });

  it("lets an upgraded owner create unlimited boards", async () => {
    const { t, workspaceId } = await setup();
    await activatePro(t);
    const as = t.withIdentity(MEMBER);
    for (let i = 0; i < 6; i++) await as.mutation(api.slates.create, { title: `b${i}`, workspaceId, thumbnailIcon: "1" });
    const billing = await t.withIdentity(OWNER).query(api.billing.getMyBilling, {});
    expect(billing?.boards.used).toBeNull();
  });
});

describe("dashboard extras", () => {
  it("stars boards per user and reports counts reported by an editor", async () => {
    const { t, workspaceId } = await setup();
    const id = await t.withIdentity(OWNER).mutation(api.slates.create, { title: "Arch", workspaceId, thumbnailIcon: "1" });
    expect((await t.withIdentity(OWNER).query(api.slates.list, { workspaceId }))[0]).toMatchObject({ isFavorite: false, nodeCount: null });

    await t.withIdentity(OWNER).mutation(api.slates.setFavorite, { id, favorite: true });
    await t.withIdentity(OWNER).mutation(api.slates.reportStats, { id, nodes: 18, connectors: 12 });
    expect((await t.withIdentity(OWNER).query(api.slates.list, { workspaceId }))[0]).toMatchObject({ isFavorite: true, nodeCount: 18, connectorCount: 12 });
    // someone else's star is their own
    expect((await t.withIdentity(MEMBER).query(api.slates.list, { workspaceId }))[0]).toMatchObject({ isFavorite: false, nodeCount: 18 });

    await t.withIdentity(OWNER).mutation(api.slates.setFavorite, { id, favorite: false });
    expect((await t.withIdentity(OWNER).query(api.slates.list, { workspaceId }))[0].isFavorite).toBe(false);
  });

  it("only editors may report counts", async () => {
    const { t, workspaceId } = await setup();
    const id = await t.withIdentity(OWNER).mutation(api.slates.create, { title: "Arch", workspaceId, thumbnailIcon: "1" });
    await expect(t.withIdentity({ subject: "user_x", email: "x@example.com", name: "X" }).mutation(api.slates.reportStats, { id, nodes: 1, connectors: 1 })).rejects.toThrow();
  });

  it("shows member counts and plan on workspaces", async () => {
    const { t } = await setup();
    const [ws] = await t.withIdentity(OWNER).query(api.workspaces.listMyWorkspaces, {});
    expect(ws).toMatchObject({ memberCount: 2, plan: "free" });
    await activatePro(t);
    const [after] = await t.withIdentity(MEMBER).query(api.workspaces.listMyWorkspaces, {});
    expect(after.plan).toBe("pro");
  });
});
