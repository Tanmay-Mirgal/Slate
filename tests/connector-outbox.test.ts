import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emitEvent } from "@/lib/connector/events/emit";
import { inOutbox, supportsTransactions } from "@/lib/connector/events/outbox";
import { getCollections } from "@/lib/db/mongo";
import * as slateFns from "@/lib/server/slates";
import { disableConnector, enableConnector, makeGrant, seedUsers } from "./helpers/connector";
import { ctxFor, EDITOR, OWNER, resetDb, setup, startReplDb, stopDb } from "./helpers/db";

/** C19: an event exists if and only if the change that caused it committed. Needs transactions, i.e. a replica set (as Atlas is). */

beforeAll(async () => {
  enableConnector();
  await startReplDb();
});
afterAll(async () => {
  await stopDb();
  disableConnector();
});
beforeEach(async () => {
  await resetDb();
  await seedUsers();
});

const actor = { id: OWNER.subject, name: "Owner One", kind: "user" as const };

async function connectedWorkspace() {
  const ctx = await setup();
  await makeGrant({ userId: EDITOR.subject, workspaceId: ctx.workspaceId, scopes: ["slate:boards:read"] });
  return ctx;
}

describe("transactional outbox", () => {
  it("detects the replica set", async () => {
    expect(await supportsTransactions()).toBe(true);
  });

  it("commits the change and its event together", async () => {
    const { workspaceId, slateId } = await connectedWorkspace();
    const c = await getCollections();
    await inOutbox(async (session) => {
      await c.slates.updateOne({ _id: slateId }, { $set: { title: "Renamed" } }, { session });
      await emitEvent({ workspaceId, type: "board.updated", boardId: slateId, data: { n: 1 }, actor }, session);
    });
    expect((await c.slates.findOne({ _id: slateId }))!.title).toBe("Renamed");
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(1);
  });

  it("rolls back both when the change fails after the event was written (no phantom event)", async () => {
    const { workspaceId, slateId } = await connectedWorkspace();
    const c = await getCollections();
    await expect(
      inOutbox(async (session) => {
        await emitEvent({ workspaceId, type: "board.updated", boardId: slateId, data: {}, actor }, session);
        await c.slates.updateOne({ _id: slateId }, { $set: { title: "Never visible" } }, { session });
        throw new Error("the change failed");
      })
    ).rejects.toThrow("the change failed");
    expect((await c.slates.findOne({ _id: slateId }))!.title).toBe("Board");
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(0);
    expect((await c.connectorCounters.findOne({ _id: workspaceId }))?.seq ?? 0).toBe(0); // the cursor was not burned either
  });

  it("hands out unique, gap-free cursors to concurrent writers", async () => {
    const { workspaceId, slateId } = await connectedWorkspace();
    await Promise.all(Array.from({ length: 12 }, (_, i) => inOutbox(async (session) => void (await emitEvent({ workspaceId, type: "board.updated", boardId: slateId, data: { i }, actor }, session)))));
    const c = await getCollections();
    const cursors = (await c.connectorEvents.find({ workspaceId }).toArray()).map((e) => e.cursor).sort((a, b) => a - b);
    expect(cursors).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("makes a status change and its events atomic through the app's own function", async () => {
    const { workspaceId, slateId } = await connectedWorkspace();
    const c = await getCollections();
    await slateFns.applyBoardStatus(ctxFor(OWNER), slateId, "approved", { via: "ui" });
    expect((await c.slates.findOne({ _id: slateId }))!.status).toBe("approved");
    expect((await c.connectorEvents.find({ workspaceId }).toArray()).map((e) => e.type).sort()).toEqual(["board.approved", "board.status_changed"]);

    // a competing change that loses the compare-and-set leaves no event behind
    const before = await c.connectorEvents.countDocuments({ workspaceId });
    await c.slates.updateOne({ _id: slateId }, { $set: { status: "draft" } });
    const stale = slateFns.applyBoardStatus(ctxFor(OWNER), slateId, "in_review", { via: "ui" });
    await expect(stale).resolves.toMatchObject({ changed: true }); // read draft, moved to in_review: a normal change
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(before + 1);
  });

  it("emits nothing for a workspace nobody is connected to", async () => {
    const { workspaceId, slateId } = await setup();
    const c = await getCollections();
    await slateFns.applyBoardStatus(ctxFor(OWNER), slateId, "approved", { via: "ui" });
    expect(await c.connectorEvents.countDocuments({ workspaceId })).toBe(0);
  });
});
