import { z } from "zod";
import { defineEvent } from "../registry/define";
import { boardSchema, linkAccessSchema, boardStatusSchema } from "../resources/boards";

/**
 * The events Slate sends. The manifest lists them with these schemas, so the Hub knows what each carries.
 * Payloads never hold secrets, tokens or more personal data than the matching resource already returns.
 */

const stats = z.object({ nodes: z.number(), connectors: z.number() });
const person = z.object({ id: z.string(), name: z.string() });
const READ = ["slate:boards:read"] as const;

export const diagramSummarySchema = z.object({
  kind: z.string(),
  nodes: z.number(),
  edges: z.number(),
  groups: z.number(),
});

export const boardCreated = defineEvent({ type: "board.created", description: "A board was created in the workspace (in the app or through the connector).", scopes: READ, data: z.object({ board: boardSchema }) });
export const boardArchived = defineEvent({ type: "board.archived", description: "A board was archived (removed from the workspace's boards).", scopes: READ, data: z.object({ board: boardSchema }) });
export const boardUpdated = defineEvent({
  type: "board.updated",
  description: "A board's content changed. Coalesced: at most one event per board per minute, however much was edited.",
  scopes: READ,
  data: z.object({ board: boardSchema, stats }),
});
export const generationStarted = defineEvent({ type: "board.generation.started", description: "An AI diagram generation started.", scopes: READ, data: z.object({ board: boardSchema.nullable(), operationId: z.string() }) });
export const generationCompleted = defineEvent({
  type: "board.generation.completed",
  description: "An AI diagram generation finished and the diagram is on the board.",
  scopes: READ,
  data: z.object({ board: boardSchema, operationId: z.string(), diagram: diagramSummarySchema }),
});
export const generationFailed = defineEvent({
  type: "board.generation.failed",
  description: "An AI diagram generation failed. Reserved AI credits were handed back.",
  scopes: READ,
  data: z.object({ board: boardSchema.nullable(), operationId: z.string(), error: z.object({ code: z.string(), message: z.string() }) }),
});
export const statusChanged = defineEvent({
  type: "board.status_changed",
  description: "A board moved between draft, in review and approved.",
  scopes: READ,
  data: z.object({ board: boardSchema, from: boardStatusSchema, to: boardStatusSchema, note: z.string().optional(), by: person }),
});
export const boardApproved = defineEvent({
  type: "board.approved",
  description: "A design was approved. The signal that a design is ready to be built.",
  scopes: READ,
  data: z.object({ board: boardSchema, note: z.string().optional(), by: person, stats, dslBytes: z.number().describe("Size of the approved diagram as diagram-as-code") }),
});
export const boardShared = defineEvent({ type: "board.shared", description: "A board's link sharing was changed.", scopes: READ, data: z.object({ board: boardSchema, linkAccess: linkAccessSchema }) });
export const commentCreated = defineEvent({
  type: "comment.created",
  description: "A comment thread was started or a reply was added.",
  scopes: ["slate:comments:read"],
  data: z.object({ board: boardSchema, comment: z.object({ id: z.string(), authorName: z.string(), body: z.string(), createdAt: z.string() }) }),
});

export const EVENT_DEFINITIONS = [boardCreated, boardArchived, boardUpdated, generationStarted, generationCompleted, generationFailed, statusChanged, boardApproved, boardShared, commentCreated] as const;
