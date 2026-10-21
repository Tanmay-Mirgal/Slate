import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api } from "@/lib/client/api";
import { getCollections, newDocId } from "@/lib/db/mongo";
import { lookup } from "@/lib/server/registry";
import { deleteUser, ensureUser, profileFromClerk, profileFromWebhook, upsertUser } from "@/lib/server/users";
import { as, EDITOR, OWNER, resetDb, setup, startDb, stopDb, type TestUser } from "./helpers/db";

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const NEWBIE: TestUser = { subject: "user_newbie", email: "newbie@example.com", name: "Nina Newbie" };

describe("a brand-new account can create boards (the 'new users cannot create a canvas' bug)", () => {
  it("gets a personal workspace of their own on first sign-in", async () => {
    const newbie = as(NEWBIE);
    expect(await newbie.query(api.workspaces.listMyWorkspaces)).toEqual([]);
    const { workspaceId } = await newbie.mutation(api.users.ensureProvisioned);
    const [ws] = await newbie.query(api.workspaces.listMyWorkspaces);
    expect(ws).toMatchObject({ _id: workspaceId, name: "Nina Newbie's Slate", ownerId: NEWBIE.subject, role: "Admin", memberCount: 1, plan: "free" });
    // and the profile was stored too
    expect(await (await getCollections()).users.findOne({ clerkId: NEWBIE.subject })).toMatchObject({ email: NEWBIE.email, firstName: "Nina", lastName: "Newbie" });
  });

  it("creates exactly one workspace however often, or however concurrently, it is asked", async () => {
    const newbie = as(NEWBIE);
    const ids = await Promise.all(Array.from({ length: 8 }, () => newbie.mutation(api.users.ensureProvisioned).then((r) => r.workspaceId)));
    expect(new Set(ids).size).toBe(1);
    await newbie.mutation(api.users.ensureProvisioned);
    const c = await getCollections();
    expect(await c.workspaces.countDocuments({ ownerId: NEWBIE.subject })).toBe(1);
    expect(await c.workspaceMembers.countDocuments({ userId: NEWBIE.subject })).toBe(1);
  });

  it("can make a board straight away, with or without naming a workspace", async () => {
    const newbie = as(NEWBIE);
    const { workspaceId } = await newbie.mutation(api.users.ensureProvisioned);
    const a = await newbie.mutation(api.slates.create, { title: "First", workspaceId, thumbnailIcon: "1" });
    // a client that never heard of the workspace still works: the server finds (or makes) the default one
    const stranger = as({ subject: "user_other", email: "other@example.com", name: "Otto" });
    const b = await stranger.mutation(api.slates.create, { title: "Second", thumbnailIcon: "2" });
    expect((await newbie.query(api.slates.list, { workspaceId })).map((s) => s._id)).toEqual([a]);
    expect((await stranger.query(api.workspaces.listMyWorkspaces))).toHaveLength(1);
    expect(await stranger.query(api.slates.getById, { id: b })).toMatchObject({ title: "Second", access: "edit", canManage: true });
  });

  it("doesn't add a second workspace for someone who already has one", async () => {
    const { workspaceId } = await setup();
    const owner = as(OWNER);
    expect((await owner.mutation(api.users.ensureProvisioned)).workspaceId).toBe(workspaceId);
    expect(await (await getCollections()).workspaces.countDocuments({ ownerId: OWNER.subject })).toBe(1);
  });

  it("needs a signed-in user", async () => {
    await expect(as(null).mutation(api.users.ensureProvisioned)).rejects.toThrow(/Unauthenticated/);
    await expect(as(null).mutation(api.slates.create, { title: "x", thumbnailIcon: "1" })).rejects.toThrow(/Unauthenticated/);
  });
});

describe("keeping MongoDB in step with Clerk", () => {
  const profile = { email: "Ada@Example.com", emails: ["ada@example.com", "Ada.Work@Example.com"], firstName: "Ada", lastName: "Lovelace", imageUrl: "https://img/ada.png" };

  it("upserts a user: one row per Clerk id, emails lower-cased, later calls update it", async () => {
    const rows = await Promise.all(Array.from({ length: 6 }, () => upsertUser("user_ada", profile)));
    expect(new Set(rows.map((r) => r._id)).size).toBe(1); // concurrent first sightings converge on one row
    const c = await getCollections();
    expect(await c.users.countDocuments({ clerkId: "user_ada" })).toBe(1);
    const stored = await c.users.findOne({ clerkId: "user_ada" });
    expect(stored?.emails?.sort()).toEqual(["ada.work@example.com", "ada@example.com"]);

    const renamed = await upsertUser("user_ada", { ...profile, firstName: "Augusta" });
    expect(renamed).toMatchObject({ _id: stored!._id, firstName: "Augusta", createdAt: stored!.createdAt });
  });

  it("keeps billing state when the profile is refreshed", async () => {
    await upsertUser("user_ada", profile);
    const c = await getCollections();
    await c.users.updateOne({ clerkId: "user_ada" }, { $set: { subscriptionTier: "pro", subscriptionStatus: "active", aiCreditsUsedThisPeriod: 4 } });
    await upsertUser("user_ada", { ...profile, imageUrl: null });
    expect(await c.users.findOne({ clerkId: "user_ada" })).toMatchObject({ subscriptionTier: "pro", aiCreditsUsedThisPeriod: 4, imageUrl: null });
  });

  it("maps Clerk's webhook payload: primary address first, only verified extras", () => {
    const p = profileFromWebhook({
      primary_email_address_id: "idn_2",
      email_addresses: [
        { id: "idn_1", email_address: "first@example.com", verification: { status: "verified" } },
        { id: "idn_2", email_address: "Primary@Example.com", verification: { status: "verified" } },
        { id: "idn_3", email_address: "unverified@example.com", verification: { status: "unverified" } },
      ],
      first_name: "Pat",
      last_name: "",
      image_url: "https://img/p.png",
    });
    expect(p).toMatchObject({ email: "Primary@Example.com", firstName: "Pat", lastName: null, imageUrl: "https://img/p.png" });
    expect(p.emails.sort()).toEqual(["first@example.com", "primary@example.com"]);
    expect(profileFromWebhook({}).email).toBe("");
  });

  it("maps a Clerk backend user the same way", () => {
    const p = profileFromClerk({
      primaryEmailAddressId: "e1",
      emailAddresses: [{ id: "e1", emailAddress: "a@example.com", verification: { status: "verified" } }],
      firstName: null,
      lastName: "Solo",
      imageUrl: "",
    });
    expect(p).toEqual({ email: "a@example.com", emails: ["a@example.com"], firstName: null, lastName: "Solo", imageUrl: null });
  });

  it("creates a missing user on first sight from Clerk, and doesn't ask Clerk again once it has them", async () => {
    let asked = 0;
    const source = async () => (asked++, profile);
    const first = await ensureUser("user_lazy", source);
    const again = await ensureUser("user_lazy", source);
    expect(first._id).toBe(again._id);
    expect(asked).toBe(1);
  });

  it("still lets a user in when Clerk can't be reached, and retries later", async () => {
    const down = async () => {
      throw new Error("network down");
    };
    const row = await ensureUser("user_offline", down);
    expect(row).toMatchObject({ clerkId: "user_offline", email: "" });
    const healed = await ensureUser("user_offline", async () => profile);
    expect(healed._id).toBe(row._id);
    expect(healed.email).toBe("Ada@Example.com");
  });

  it("removes a deleted account's row and memberships but keeps the boards they made", async () => {
    const { workspaceId, slateId } = await setup();
    await upsertUser(EDITOR.subject, profile);
    await deleteUser(EDITOR.subject);
    const c = await getCollections();
    expect(await c.users.findOne({ clerkId: EDITOR.subject })).toBeNull();
    expect(await c.workspaceMembers.findOne({ workspaceId, userId: EDITOR.subject })).toBeNull();
    expect(await c.slates.findOne({ _id: slateId })).not.toBeNull();
  });
});

describe("invitations", () => {
  async function invited(email = "guest@example.com", role: "Viewer" | "Editor" | "Admin" = "Editor") {
    const { workspaceId } = await setup();
    const inviteId = await as(OWNER).mutation(api.workspaces.createInvite, { workspaceId, recipientEmail: ` ${email.toUpperCase()} `, role });
    return { workspaceId, inviteId };
  }
  const guest: TestUser = { subject: "user_guest", email: "guest@example.com", name: "Guest Person" };

  it("reach the person by any of their verified addresses and add them once", async () => {
    const { workspaceId, inviteId } = await invited("work@example.com");
    await upsertUser(guest.subject, { email: "guest@example.com", emails: ["guest@example.com", "work@example.com"], firstName: "Guest", lastName: "Person", imageUrl: null });
    const g = as(guest);
    const pending = await g.query(api.workspaces.getMyPendingInvites);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ _id: inviteId, workspaceName: "WS", role: "Editor" });

    await Promise.all([g.mutation(api.workspaces.respondToInvite, { inviteId, accept: true }), g.mutation(api.workspaces.respondToInvite, { inviteId, accept: true }).catch(() => undefined)]);
    expect(await (await getCollections()).workspaceMembers.countDocuments({ workspaceId, userId: guest.subject })).toBe(1);
    expect(await g.query(api.workspaces.getMyPendingInvites)).toEqual([]);
    expect((await g.query(api.workspaces.listMyWorkspaces))[0]).toMatchObject({ _id: workspaceId, role: "Editor" });
  });

  it("can't be answered by somebody else, or twice", async () => {
    const { inviteId } = await invited();
    await expect(as(EDITOR).mutation(api.workspaces.respondToInvite, { inviteId, accept: true })).rejects.toThrow(/Invalid invite/);
    await upsertUser(guest.subject, { email: guest.email, emails: [guest.email], firstName: "G", lastName: null, imageUrl: null });
    await as(guest).mutation(api.workspaces.respondToInvite, { inviteId, accept: false });
    await expect(as(guest).mutation(api.workspaces.respondToInvite, { inviteId, accept: true })).rejects.toThrow(/Invalid invite/);
    expect(await (await getCollections()).workspaceMembers.countDocuments({ userId: guest.subject })).toBe(0);
  });

  it("are only sent by workspace admins, and re-inviting updates the open one", async () => {
    const { workspaceId, inviteId } = await invited();
    await expect(as(EDITOR).mutation(api.workspaces.createInvite, { workspaceId, recipientEmail: "x@example.com", role: "Viewer" })).rejects.toThrow(/Unauthorized/);
    const again = await as(OWNER).mutation(api.workspaces.createInvite, { workspaceId, recipientEmail: "guest@example.com", role: "Viewer" });
    expect(again).toBe(inviteId);
    expect(await as(OWNER).query(api.workspaces.listPendingInvites, { workspaceId })).toEqual([expect.objectContaining({ email: "guest@example.com", role: "Viewer" })]);
    await expect(as(OWNER).mutation(api.workspaces.createInvite, { workspaceId, recipientEmail: "not-an-email", role: "Viewer" })).rejects.toThrow(/Invalid request/);
  });

  it("show who shared a board, and with whom", async () => {
    const { workspaceId, inviteId } = await invited();
    const c = await getCollections();
    await c.slates.insertOne({ _id: newDocId(), title: "Shared one", workspaceId, isArchived: false, createdAt: 1, lastEdited: 5, thumbnailIcon: "1" });
    await upsertUser(OWNER.subject, { email: OWNER.email, emails: [OWNER.email], firstName: "Olivia", lastName: "Owner", imageUrl: null });
    await upsertUser(guest.subject, { email: guest.email, emails: [guest.email], firstName: "Guest", lastName: "Person", imageUrl: null });
    await as(guest).mutation(api.workspaces.respondToInvite, { inviteId, accept: true });

    const shared = await as(guest).query(api.slates.listShared);
    expect(shared.map((s) => s.title)).toEqual(["Shared one", "Board"]); // newest first
    expect(shared[0]).toMatchObject({ title: "Shared one", workspaceName: "WS", sharedBy: { name: "Olivia Owner", email: OWNER.email } });
    const byMe = await as(OWNER).query(api.slates.listSharedByMe);
    expect(byMe[0].sharedWith).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Guest Person", role: "Editor" })]));
    expect(byMe[0].sharedWith.map((p) => p.role).sort()).toEqual(["Editor", "Editor", "Viewer"]); // the owner themself is not listed
  });
});

describe("what the browser can call", () => {
  it("only reaches declared server functions", () => {
    expect(lookup("slates.list")).toBeDefined();
    expect(lookup("users.ensureProvisioned")).toBeDefined();
    for (const bad of ["", "slates", "slates.", ".list", "slates.list.x", "constructor.constructor", "__proto__.x", "slates.__proto__", "slates.toString", "nope.list", "slates.nope"]) {
      expect(lookup(bad), bad).toBeUndefined();
    }
  });
});
