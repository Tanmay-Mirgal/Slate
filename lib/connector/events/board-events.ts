import type { ClientSession } from "mongodb";
import { getCollections } from "@/lib/db/mongo";
import type { SlateDoc } from "@/lib/db/types";
import type { Ctx } from "@/lib/server/fn";
import { displayName } from "@/lib/server/profile";
import { boardWire, namesFor } from "../data";
import { takeConnectorToken } from "../ratelimit";
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

/**
 * `board.updated`: sent at most once per board per minute however much was edited. It is called from the
 * debounced "board was touched" path of `elements.apply` (which already runs at most every 30 seconds per board),
 * never per element, and always after the response.
 */
export async function emitBoardUpdated(slateId: string, userId: string): Promise<void> {
  const c = await getCollections();
  const slate = await c.slates.findOne({ _id: slateId }, { projection: { documentText: 0, documentJson: 0, elements: 0 } });
  if (!slate?.workspaceId || slate.isArchived) return;
  if (!(await workspaceHasConnector(slate.workspaceId))) return;
  if (!(await takeConnectorToken(`board-updated:${slateId}`, 1, 60_000)).allowed) return;
  const names = await namesFor([userId]);
  await emitBoardEvent("board.updated", slate, { id: userId, name: names.get(userId) ?? "Someone", kind: "user" }, (board) => ({ stats: board.stats ?? { nodes: 0, connectors: 0 } }));
}

export async function emitCommentCreated(slate: SlateDoc, actor: EventActor, comment: { id: string; authorName: string; body: string; createdAt: number }, session?: ClientSession): Promise<string | null> {
  return await emitBoardEvent("comment.created", slate, actor, () => ({ comment: { id: comment.id, authorName: comment.authorName, body: comment.body, createdAt: new Date(comment.createdAt).toISOString() } }), session);
}
