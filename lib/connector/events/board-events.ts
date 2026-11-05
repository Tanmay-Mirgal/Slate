import type { ClientSession } from "mongodb";
import { getCollections } from "@/lib/db/mongo";
import type { SlateDoc } from "@/lib/db/types";
import type { Ctx } from "@/lib/server/fn";
import { displayName } from "@/lib/server/profile";
import { boardWire } from "../data";
import { emitEvent, workspaceHasConnector, type EventActor } from "./emit";

/**
 * Builders for the events about boards. Slate's own server functions (create, archive, share, status...) call
 * these from the same code path the connector uses, so a change made in the app and the same change made through
 * the API produce the same event. All of them do nothing unless an app is connected to the workspace.
 */

/** Who did it: the signed-in person, as themselves, or as the connection acting for them. */
export async function actorOf(ctx: Ctx, via: "ui" | "connector"): Promise<EventActor> {
  const user = await ctx.profile();
  return { id: ctx.userId ?? "", name: displayName(user), kind: via === "connector" ? "connector" : "user" };
}

/**
 * Appends `type` for a board. `extra` receives the board as it goes on the wire (stats and names resolved) and adds
 * the rest of the payload. Pass the `session` of `inOutbox` to make the event commit with the change.
 */
export async function emitBoardEvent(type: string, slate: SlateDoc, actor: EventActor, extra: (board: Awaited<ReturnType<typeof boardWire>>) => Record<string, unknown> = () => ({}), session?: ClientSession): Promise<string | null> {
  if (!slate.workspaceId || !(await workspaceHasConnector(slate.workspaceId, session))) return null;
  const board = await boardWire(slate);
  return await emitEvent({ workspaceId: slate.workspaceId, type, boardId: slate._id, data: { board, ...extra(board) }, actor, externalRef: slate.externalRef }, session);
}

/** A board taken back right after creation (plan limit overshoot) must not leave a `board.created` nobody has seen yet. */
export async function retractCreated(boardId: string): Promise<void> {
  const c = await getCollections();
  await c.connectorEvents.deleteMany({ boardId, type: "board.created", pending: true });
}
