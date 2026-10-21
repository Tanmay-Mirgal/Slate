import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "@/lib/client/api";
import { getCollections, newDocId } from "@/lib/db/mongo";
import { refundAiCredit, reserveAiCredit, syncSubscription, type SyncSubscriptionInput } from "@/lib/server/billing";
import { lookup } from "@/lib/server/registry";
import { as, OWNER, resetDb, startDb, stopDb, type TestUser } from "./helpers/db";

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const MEMBER: TestUser = { subject: "user_member", email: "member@example.com", name: "Member" };

async function setup() {
  const c = await getCollections();
  await c.users.insertOne({ _id: newDocId(), clerkId: OWNER.subject, email: OWNER.email, firstName: "Own", lastName: "Er", imageUrl: null, createdAt: 1 });
  const workspaceId = newDocId();
  await c.workspaces.insertOne({ _id: workspaceId, name: "WS", ownerId: OWNER.subject, createdAt: 1, updatedAt: 1 });
  await c.workspaceMembers.insertOne({ _id: newDocId(), workspaceId, userId: OWNER.subject, role: "Admin", addedAt: 1 });
  await c.workspaceMembers.insertOne({ _id: newDocId(), workspaceId, userId: MEMBER.subject, role: "Editor", addedAt: 1 });
  return { workspaceId };
}

const activatePro = (extra: Partial<SyncSubscriptionInput> = {}) =>
  syncSubscription({ clerkId: OWNER.subject, tier: "pro", status: "active", interval: "monthly", currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000, resetCredits: true, ...extra });

describe("who can change a plan", () => {
  it("plan changes and credit refunds are not reachable from the browser", async () => {
    // only functions declared with query() / mutation() can be called over /api/rpc
    for (const name of ["billing.syncSubscription", "billing.reserveAiCredit", "billing.refundAiCredit", "usage.takeToken", "usage.consume", "versions.autoSnapshot", "users.upsertUser", "users.deleteUser"]) {
      expect(lookup(name), name).toBeUndefined();
    }
    expect(lookup("billing.getMyBilling")).toBeDefined();
    await setup();
    expect((await as(OWNER).query(api.billing.getMyBilling))?.tier).toBe("free");
  });
});

describe("syncSubscription", () => {
  it("activates a plan and refills credits", async () => {
    await setup();
    const r = await activatePro({ razorpaySubscriptionId: "sub_1", razorpayPlanId: "plan_1" });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    const billing = await as(OWNER).query(api.billing.getMyBilling);
    expect(billing).toMatchObject({ tier: "pro", status: "active", interval: "monthly", boards: { limit: null }, ai: { cap: 300, used: 0 } });
  });

  it("applies a webhook event once", async () => {
    await setup();
    expect(await activatePro({ eventId: "evt_1", eventType: "subscription.activated" })).toMatchObject({ duplicate: false });
    await reserveAiCredit(OWNER.subject);
    // a retried delivery must not refill the credits the user just spent
    expect(await activatePro({ eventId: "evt_1", eventType: "subscription.activated" })).toMatchObject({ duplicate: true });
    expect((await as(OWNER).query(api.billing.getMyBilling))?.ai.used).toBe(1);
  });

  it("applies a webhook event once even when two deliveries arrive at the same time", async () => {
    await setup();
    const results = await Promise.all([1, 2, 3, 4].map(() => activatePro({ eventId: "evt_race" })));
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
  });

  it("finds the user by subscription id when the notes are missing", async () => {
    await setup();
    await activatePro({ razorpaySubscriptionId: "sub_find" });
    const r = await syncSubscription({ razorpaySubscriptionId: "sub_find", tier: "pro", status: "cancelled", currentPeriodEnd: Date.now() + 1000 * 60 * 60 });
    expect(r).toMatchObject({ ok: true });
    expect(await as(OWNER).query(api.billing.getMyBilling)).toMatchObject({ tier: "pro", status: "cancelled", endsAtPeriodEnd: true });
  });

  it("reports an unknown user instead of inventing one, and lets the retry succeed later", async () => {
    await setup();
    expect(await syncSubscription({ clerkId: "user_ghost", tier: "pro", status: "active", eventId: "evt_ghost" })).toEqual({ ok: false, reason: "user_not_found" });
    // the failed delivery was not recorded, so Razorpay's retry is applied once the user exists
    const c = await getCollections();
    await c.users.insertOne({ _id: newDocId(), clerkId: "user_ghost", email: "g@example.com", firstName: null, lastName: null, imageUrl: null, createdAt: 1 });
    expect(await syncSubscription({ clerkId: "user_ghost", tier: "pro", status: "active", eventId: "evt_ghost" })).toMatchObject({ ok: true, duplicate: false });
  });

  it("creates the user from the checkout profile when Clerk hasn't told us about them yet", async () => {
    await setup();
    const r = await syncSubscription({ clerkId: "user_fresh", tier: "pro", status: "active", profile: { email: "fresh@example.com", emails: ["fresh@example.com"], firstName: "Fre", lastName: "Sh", imageUrl: null } });
    expect(r).toMatchObject({ ok: true });
    expect((await (await getCollections()).users.findOne({ clerkId: "user_fresh" }))?.subscriptionTier).toBe("pro");
  });

  it("tells the caller which earlier subscription a new one replaces", async () => {
    await setup();
    await activatePro({ razorpaySubscriptionId: "sub_old" });
    expect(await activatePro({ razorpaySubscriptionId: "sub_new" })).toMatchObject({ ok: true, previousSubscriptionId: "sub_old" });
  });

  it("drops to free once a cancelled plan's period has ended", async () => {
    await setup();
    await activatePro({ status: "cancelled", currentPeriodEnd: Date.now() - 1000 });
    expect((await as(OWNER).query(api.billing.getMyBilling))?.tier).toBe("free");
  });
});

describe("AI credits", () => {
  it("lets a free user spend 15 credits and then refuses", async () => {
    await setup();
    for (let i = 1; i <= 15; i++) {
      expect(await reserveAiCredit(OWNER.subject)).toMatchObject({ ok: true, used: i, cap: 15 });
    }
    expect(await reserveAiCredit(OWNER.subject)).toMatchObject({ ok: false, tier: "free", cap: 15, used: 15, remaining: 0 });
  });

  it("never lets parallel requests spend more than the allowance", async () => {
    await setup();
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveAiCredit(OWNER.subject)));
    expect(results.filter((r) => r.ok)).toHaveLength(15);
    expect((await as(OWNER).query(api.billing.getMyBilling))?.ai.used).toBe(15);
  });

  it("gives credits back, never below zero", async () => {
    await setup();
    await reserveAiCredit(OWNER.subject);
    await reserveAiCredit(OWNER.subject);
    await refundAiCredit(OWNER.subject);
    expect((await as(OWNER).query(api.billing.getMyBilling))?.ai.used).toBe(1);
    await refundAiCredit(OWNER.subject, 5);
    expect((await as(OWNER).query(api.billing.getMyBilling))?.ai.used).toBe(0);
    expect(await refundAiCredit("nobody")).toEqual({ ok: false });
  });

  it("creates the user row on first use", async () => {
    await setup();
    const source = async () => ({ email: "new@example.com", emails: ["new@example.com"], firstName: "New", lastName: null, imageUrl: null });
    expect(await reserveAiCredit("user_new", 1, source)).toMatchObject({ ok: true, used: 1 });
    expect((await (await getCollections()).users.findOne({ clerkId: "user_new" }))?.email).toBe("new@example.com");
  });

  it("gives paid plans a bigger allowance", async () => {
    await setup();
    await activatePro();
    expect(await reserveAiCredit(OWNER.subject)).toMatchObject({ ok: true, tier: "pro", cap: 300 });
  });
});

describe("board cap", () => {
  it("stops a free workspace owner at three boards, including boards teammates create", async () => {
    const { workspaceId } = await setup();
    const create = (who: TestUser, title: string) => as(who).mutation(api.slates.create, { title, workspaceId, thumbnailIcon: "1" });
    await create(OWNER, "one");
    await create(MEMBER, "two");
    await create(OWNER, "three");
    await expect(create(MEMBER, "four")).rejects.toMatchObject({ data: { code: "board_limit", limit: 3, tier: "free" } });
    expect((await as(OWNER).query(api.billing.getMyBilling))?.boards).toEqual({ used: 3, limit: 3 });
  });

  it("holds the cap even when boards are created at the same moment", async () => {
    const { workspaceId } = await setup();
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => as(OWNER).mutation(api.slates.create, { title: `b${i}`, workspaceId, thumbnailIcon: "1" })));
    expect(attempts.filter((a) => a.status === "fulfilled").length).toBeLessThanOrEqual(3);
    expect((await as(OWNER).query(api.billing.getMyBilling))?.boards.used).toBeLessThanOrEqual(3);
  });

  it("frees a slot when a board is deleted", async () => {
    const { workspaceId } = await setup();
    const owner = as(OWNER);
    const ids = [];
    for (const title of ["a", "b", "c"]) ids.push(await owner.mutation(api.slates.create, { title, workspaceId, thumbnailIcon: "1" }));
    await expect(owner.mutation(api.slates.create, { title: "d", workspaceId, thumbnailIcon: "1" })).rejects.toThrow();
    await owner.mutation(api.slates.remove, { id: ids[0] });
    await expect(owner.mutation(api.slates.create, { title: "d", workspaceId, thumbnailIcon: "1" })).resolves.toBeTruthy();
  });

  it("lets an upgraded owner create unlimited boards", async () => {
    const { workspaceId } = await setup();
    await activatePro();
    const member = as(MEMBER);
    for (let i = 0; i < 6; i++) await member.mutation(api.slates.create, { title: `b${i}`, workspaceId, thumbnailIcon: "1" });
    expect((await as(OWNER).query(api.billing.getMyBilling))?.boards.used).toBeNull();
  });
});

describe("dashboard extras", () => {
  it("stars boards per user and reports counts reported by an editor", async () => {
    const { workspaceId } = await setup();
    const id = await as(OWNER).mutation(api.slates.create, { title: "Arch", workspaceId, thumbnailIcon: "1" });
    expect((await as(OWNER).query(api.slates.list, { workspaceId }))[0]).toMatchObject({ isFavorite: false, nodeCount: null });

    await as(OWNER).mutation(api.slates.setFavorite, { id, favorite: true });
    await as(OWNER).mutation(api.slates.setFavorite, { id, favorite: true }); // starring twice is still one star
    await as(OWNER).mutation(api.slates.reportStats, { id, nodes: 18, connectors: 12 });
    expect((await as(OWNER).query(api.slates.list, { workspaceId }))[0]).toMatchObject({ isFavorite: true, nodeCount: 18, connectorCount: 12 });
    // someone else's star is their own
    expect((await as(MEMBER).query(api.slates.list, { workspaceId }))[0]).toMatchObject({ isFavorite: false, nodeCount: 18 });

    await as(OWNER).mutation(api.slates.setFavorite, { id, favorite: false });
    expect((await as(OWNER).query(api.slates.list, { workspaceId }))[0].isFavorite).toBe(false);
  });

  it("only editors may report counts", async () => {
    const { workspaceId } = await setup();
    const id = await as(OWNER).mutation(api.slates.create, { title: "Arch", workspaceId, thumbnailIcon: "1" });
    await expect(as({ subject: "user_x", email: "x@example.com", name: "X" }).mutation(api.slates.reportStats, { id, nodes: 1, connectors: 1 })).rejects.toThrow();
  });

  it("shows member counts and plan on workspaces", async () => {
    await setup();
    const [ws] = await as(OWNER).query(api.workspaces.listMyWorkspaces);
    expect(ws).toMatchObject({ memberCount: 2, plan: "free" });
    await activatePro();
    const [after] = await as(MEMBER).query(api.workspaces.listMyWorkspaces);
    expect(after.plan).toBe("pro");
  });
});
