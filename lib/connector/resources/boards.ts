import type { Filter } from "mongodb";
import { z } from "zod";
import { graphFromElements } from "@/lib/diagram/extract";
import { graphToDsl } from "@/lib/diagram/dsl";
import { getCollections } from "@/lib/db/mongo";
import type { BoardStatus, CommentThreadDoc, SlateDoc } from "@/lib/db/types";
import { MAX_MESSAGES_PER_THREAD } from "@/lib/comments/logic";
import { connectorConfig } from "../config";
import { boardWire, decodeCursor, encodeCursor, escapeRegex, iso, loadBoardElements, loadGrantBoard, namesFor, pageOfArray, statsFor, toBoard } from "../data";
import { defineResource } from "../registry/define";
import { externalRefSchema, pageOf, paginationQuery } from "../registry/schema";
import { builtInTemplates } from "../templates";

const timestamp = z.string().meta({ description: "ISO-8601 UTC timestamp", examples: ["2026-01-01T10:00:00.000Z"] });
const none = z.strictObject({});

/* ------------------------------------------------------------------ shared wire shapes */

export const boardStatusSchema = z.enum(["draft", "in_review", "approved"]).meta({ title: "Status", description: "Review state of the design" });
export const linkAccessSchema = z.enum(["none", "view", "edit"]).meta({ title: "Link access", description: "Who can open the board with just the link" });

export const boardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: boardStatusSchema,
    linkAccess: linkAccessSchema,
    thumbnailIcon: z.string(),
    webUrl: z.string().meta({ description: "Deep link into Slate" }),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdVia: z.enum(["ui", "connector"]),
    stats: z.object({ nodes: z.number(), connectors: z.number() }).nullable().describe("Null until a board has been opened in the editor once"),
    statusChangedAt: timestamp.optional(),
    statusChangedBy: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    externalRef: externalRefSchema.optional(),
  })
  .meta({ title: "Board" });

const columnSchema = z.object({ name: z.string(), type: z.string().optional(), key: z.enum(["pk", "fk", "unique"]).optional() });
export const graphSchema = z
  .object({
    kind: z.enum(["architecture", "flowchart", "mindmap", "erd", "sequence"]),
    title: z.string().optional(),
    direction: z.enum(["down", "right", "auto"]).optional(),
    nodes: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        subtitle: z.string().optional(),
        icon: z.string().optional(),
        shape: z.string().optional(),
        color: z.string().optional(),
        group: z.string().optional(),
        fields: z.array(columnSchema).optional(),
      })
    ),
    groups: z.array(z.object({ id: z.string(), label: z.string(), parent: z.string().optional(), color: z.string().optional(), icon: z.string().optional() })),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional(), style: z.enum(["solid", "dashed", "dotted"]).optional(), arrow: z.enum(["forward", "back", "both", "none"]).optional() })),
    messages: z.array(z.object({ from: z.string(), to: z.string(), label: z.string(), kind: z.enum(["sync", "async", "return"]).optional() })).optional(),
  })
  .meta({ title: "Diagram graph", description: "The semantic structure of the diagram (no coordinates)" });

/* ------------------------------------------------------------------ queries */

const listQuery = <S extends z.ZodRawShape = Record<never, never>>(extra?: S) => z.strictObject({ ...paginationQuery, ...((extra ?? {}) as S) });

const boardsQuery = listQuery({
  query: z.string().max(100).optional().meta({ title: "Search", description: "Only boards whose title contains this text (case-insensitive)" }),
  status: boardStatusSchema.optional(),
  updatedSince: z.iso.datetime({ offset: true }).optional().meta({ title: "Updated since", description: "Only boards edited at or after this ISO-8601 timestamp" }),
});

const boardCursor = z.object({ t: z.number(), id: z.string() });

/* ------------------------------------------------------------------ resources */

export const workspacesResource = defineResource({
  name: "workspaces.list",
  path: "/workspaces",
  scopes: ["slate:workspaces:read"],
  description: "The workspace this connection is pinned to, with your role in it.",
  query: listQuery(),
  output: pageOf(z.object({ id: z.string(), name: z.string(), kind: z.literal("workspace"), role: z.enum(["Admin", "Editor", "Viewer"]), isPersonal: z.boolean(), memberCount: z.number(), webUrl: z.string(), createdAt: timestamp })),
  handler: async (c, q) => {
    const db = await getCollections();
    const [workspace, memberCount] = await Promise.all([db.workspaces.findOne({ _id: c.grant.workspaceId }), db.workspaceMembers.countDocuments({ workspaceId: c.grant.workspaceId }, { limit: 1000 })]);
    const item = workspace
      ? [{ id: workspace._id, name: workspace.name, kind: "workspace" as const, role: c.grant.role, isPersonal: workspace.isPersonal === true, memberCount, webUrl: `${connectorConfig().baseUrl}/dashboard`, createdAt: iso(workspace.createdAt) }]
      : [];
    return pageOfArray(item, q.limit, q.cursor);
  },
});

export const boardsResource = defineResource({
  name: "boards.list",
  path: "/boards",
  scopes: ["slate:boards:read"],
  description: "Boards of the connected workspace, most recently edited first. Archived boards are not listed.",
  query: boardsQuery,
  output: pageOf(boardSchema),
  handler: async (c, q) => {
    const db = await getCollections();
    const cursor = decodeCursor(q.cursor, boardCursor);
    const filter: Filter<SlateDoc> = { workspaceId: c.grant.workspaceId, isArchived: false };
    // a board with no status yet is a draft
    if (q.status) filter.status = q.status === "draft" ? ({ $in: [null, "draft"] } as unknown as BoardStatus) : q.status;
    if (q.query?.trim()) filter.title = { $regex: escapeRegex(q.query.trim()), $options: "i" };
    if (q.updatedSince) filter.lastEdited = { $gte: Date.parse(q.updatedSince) };
    // keyset pagination on (lastEdited, _id): boards created or edited meanwhile never shift the pages after the cursor
    if (cursor) filter.$or = [{ lastEdited: { $lt: cursor.t } }, { lastEdited: cursor.t, _id: { $lt: cursor.id } }];

    const rows = await db.slates
      .find(filter, { projection: { documentText: 0, documentJson: 0, elements: 0 } })
      .sort({ lastEdited: -1, _id: -1 })
      .limit(q.limit + 1)
      .toArray();
    const page = rows.slice(0, q.limit);
    const [stats, names] = await Promise.all([statsFor(page.map((s) => s._id)), namesFor(page.map((s) => s.statusChangedBy ?? ""))]);
    const last = page[page.length - 1];
    return {
      items: page.map((s) => toBoard(s, stats.get(s._id), s.statusChangedBy ? names.get(s.statusChangedBy) : undefined)),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.lastEdited, id: last._id }) : null,
    };
  },
});

export const boardResource = defineResource({
  name: "boards.get",
  path: "/boards/{id}",
  scopes: ["slate:boards:read"],
  description: "One board: title, review status, size, sharing, links and the metadata / externalRef it was created with.",
  query: none,
  output: boardSchema,
  handler: async (c) => boardWire((await loadGrantBoard(c.grant, c.params.id)).slate),
});

/** Plain text of a Tiptap document: block by block, one line each. */
function textOfTiptap(node: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown, inline: string[]) => {
    if (!n || typeof n !== "object") return;
    const { type, text, content } = n as { type?: string; text?: string; content?: unknown[] };
    if (type === "text" && typeof text === "string") inline.push(text);
    else if (type === "hardBreak") inline.push("\n");
    const block = type !== "text" && type !== "hardBreak" && type !== "doc" && type !== "bulletList" && type !== "orderedList" && type !== "taskList" && type !== "table" && type !== "tableRow";
    if (Array.isArray(content)) {
      if (block && (type === "paragraph" || type === "heading" || type === "codeBlock" || type === "tableCell" || type === "tableHeader")) {
        const mine: string[] = [];
        for (const child of content) walk(child, mine);
        out.push(mine.join(""));
      } else for (const child of content) walk(child, inline);
    }
  };
  walk(node, []);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function plainText(slate: Pick<SlateDoc, "documentJson" | "documentText">): string {
  if (slate.documentJson) {
    try {
      const text = textOfTiptap(JSON.parse(slate.documentJson));
      if (text) return text;
    } catch {
      /* fall back to the markdown below */
    }
  }
  return (slate.documentText ?? "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>]+/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

export const documentResource = defineResource({
  name: "boards.document",
  path: "/boards/{id}/document",
  scopes: ["slate:boards:read"],
  description: "The written document next to the diagram, as Markdown and as plain text.",
  query: none,
  output: z.object({ markdown: z.string(), text: z.string(), bytes: z.number(), updatedAt: timestamp }),
  handler: async (c) => {
    const { slate } = await loadGrantBoard(c.grant, c.params.id, { withDocument: true });
    const markdown = slate.documentText ?? "";
    return { markdown, text: plainText(slate), bytes: Buffer.byteLength(markdown), updatedAt: iso(slate.lastEdited) };
  },
});

export const dslResource = defineResource({
  name: "boards.dsl",
  path: "/boards/{id}/dsl",
  scopes: ["slate:boards:read"],
  description: "The diagram as Slate's diagram-as-code text, which round-trips through boards.importDsl.",
  query: none,
  output: z.object({ dsl: z.string(), kind: z.string(), nodes: z.number(), edges: z.number() }),
  handler: async (c) => {
    const { slate } = await loadGrantBoard(c.grant, c.params.id);
    const graph = graphFromElements(await loadBoardElements(slate._id));
    return { dsl: graph.nodes.length ? graphToDsl(graph) : "", kind: graph.kind, nodes: graph.nodes.length, edges: graph.edges.length };
  },
});

export const graphResource = defineResource({
  name: "boards.graph",
  path: "/boards/{id}/graph",
  scopes: ["slate:boards:read"],
  description: "The semantic structure of the diagram: components, groups and connections, without coordinates.",
  query: none,
  output: graphSchema,
  handler: async (c) => {
    const { slate } = await loadGrantBoard(c.grant, c.params.id);
    return graphFromElements(await loadBoardElements(slate._id));
  },
});

const anchorSchema = z.union([
  z.object({ kind: z.literal("point"), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("element"), eid: z.string(), u: z.number(), v: z.number(), x: z.number(), y: z.number() }),
]);

export const threadSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "resolved"]),
  anchor: anchorSchema,
  author: z.object({ id: z.string(), name: z.string() }),
  createdAt: timestamp,
  lastActivityAt: timestamp,
  replyCount: z.number(),
  resolvedAt: timestamp.optional(),
  resolvedByName: z.string().optional(),
  messages: z.array(z.object({ id: z.string(), author: z.object({ id: z.string(), name: z.string() }), body: z.string(), createdAt: timestamp, editedAt: timestamp.optional() })),
});

const threadCursor = z.object({ t: z.number(), id: z.string() });

export const commentsResource = defineResource({
  name: "boards.comments",
  path: "/boards/{id}/comments",
  scopes: ["slate:comments:read"],
  description: "Comment threads on a board with their messages, most recently active first.",
  query: listQuery({ status: z.enum(["open", "resolved"]).optional() }),
  output: pageOf(threadSchema),
  handler: async (c, q) => {
    const { slate } = await loadGrantBoard(c.grant, c.params.id);
    const db = await getCollections();
    const cursor = decodeCursor(q.cursor, threadCursor);
    const filter: Filter<CommentThreadDoc> = { slateId: slate._id, ...(q.status ? { status: q.status } : {}) };
    if (cursor) filter.$or = [{ lastActivityAt: { $lt: cursor.t } }, { lastActivityAt: cursor.t, _id: { $lt: cursor.id } }];
    const rows = await db.commentThreads
      .find(filter)
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(q.limit + 1)
      .toArray();
    const page = rows.slice(0, q.limit);
    const messages = page.length ? await db.comments.find({ threadId: { $in: page.map((t) => t._id) } }).sort({ createdAt: 1 }).limit(page.length * MAX_MESSAGES_PER_THREAD).toArray() : [];
    const byThread = new Map<string, typeof messages>();
    for (const m of messages) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    const last = page[page.length - 1];
    return {
      items: page.map((t) => ({
        id: t._id,
        status: t.status,
        anchor: t.anchor,
        author: { id: t.authorId, name: t.authorName },
        createdAt: iso(t.createdAt),
        lastActivityAt: iso(t.lastActivityAt),
        replyCount: t.replyCount,
        ...(t.resolvedAt ? { resolvedAt: iso(t.resolvedAt) } : {}),
        ...(t.resolvedByName ? { resolvedByName: t.resolvedByName } : {}),
        messages: (byThread.get(t._id) ?? []).slice(0, MAX_MESSAGES_PER_THREAD).map((m) => ({
          id: m._id,
          author: { id: m.authorId, name: m.authorName },
          body: m.body,
          createdAt: iso(m.createdAt),
          ...(m.editedAt ? { editedAt: iso(m.editedAt) } : {}),
        })),
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.lastActivityAt, id: last._id }) : null,
    };
  },
});

export const templatesResource = defineResource({
  name: "templates.list",
  path: "/templates",
  scopes: ["slate:boards:read"],
  description: "Built-in templates a new board can start from (pass the id as `template` to boards.create).",
  query: listQuery(),
  output: pageOf(z.object({ id: z.string(), title: z.string(), description: z.string(), kind: z.enum(["architecture", "flowchart", "mindmap", "erd", "sequence", "interview"]) })),
  handler: async (_c, q) => pageOfArray(builtInTemplates().map(({ id, title, description, kind }) => ({ id, title, description, kind })), q.limit, q.cursor),
});

export const READ_RESOURCES = [workspacesResource, boardsResource, boardResource, documentResource, dslResource, graphResource, commentsResource, templatesResource] as const;
