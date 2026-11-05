import { z } from "zod";
import { Engine } from "@/lib/canvas/engine";
import { exportSvg } from "@/lib/canvas/export";
import { getCollections } from "@/lib/db/mongo";
import type { SlateDoc } from "@/lib/db/types";
import { graphFromElements } from "@/lib/diagram/extract";
import { graphToDsl, parseDsl } from "@/lib/diagram/dsl";
import type { Graph } from "@/lib/diagram/graph";
import { convertSource, MAX_SOURCE_CHARS, type ImportResult } from "@/lib/import";
import { composeToImport } from "@/lib/import/compose";
import { sqlToImport } from "@/lib/import/sql";
import { treeToImport } from "@/lib/import/tree";
import { invoke } from "@/lib/server/fn";
import * as slateFns from "@/lib/server/slates";
import type { AuthedGrant } from "../auth/verify";
import { boardWire, loadBoardElements, loadGrantBoard } from "../data";
import { appendMarkdown, documentFromMarkdown } from "../doc";
import { err } from "../errors";
import { graphToMermaid } from "../mermaid";
import { defineSyncAction } from "../registry/define";
import { externalRefSchema, metadataSchema } from "../registry/schema";
import { boardSchema, boardStatusSchema, linkAccessSchema } from "../resources/boards";
import { templateById } from "../templates";
import { writeDiagram } from "./diagram";

/* ------------------------------------------------------------------ shared input pieces */

export const boardIdSchema = z.string().min(1).max(120).meta({ title: "Board id", description: "Id of a board in the connected workspace (from boards.list or an earlier action)." });
export const titleSchema = z.string().trim().min(1).max(120).meta({ title: "Title", description: "Board title, up to 120 characters.", examples: ["Order platform architecture"] });
export const modeSchema = z
  .enum(["replace", "append"])
  .default("replace")
  .meta({ title: "Mode", description: "replace: what is on the board now is removed (a version is saved first, so it can be restored). append: the diagram is added to the right of what is there." });
export const documentModeSchema = z.enum(["replace", "append"]).default("append").meta({ title: "Document mode", description: "How the Markdown is written to the document pane." });

const boardOutput = z.object({ board: boardSchema });
export const diagramOutput = z.object({ kind: z.string(), nodes: z.number(), edges: z.number(), groups: z.number() });

const randomThumbnail = () => String(Math.floor(Math.random() * 5) + 1);

/* ------------------------------------------------------------------ shared steps */

interface Target {
  boardId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  externalRef?: z.infer<typeof externalRefSchema>;
}

/** The board an action works on: the one named, or a new one created for the occasion (plan limits apply). */
export async function targetBoard(grant: AuthedGrant, t: Target, fallbackTitle: string): Promise<{ slate: SlateDoc; created: boolean }> {
  if (t.boardId) {
    const { slate } = await loadGrantBoard(grant, t.boardId, { need: "edit" });
    if (t.metadata || t.externalRef) {
      const c = await getCollections();
      await c.slates.updateOne({ _id: slate._id }, { $set: { ...(t.metadata ? { metadata: t.metadata } : {}), ...(t.externalRef ? { externalRef: t.externalRef } : {}) } });
      return { slate: { ...slate, ...(t.metadata ? { metadata: t.metadata } : {}), ...(t.externalRef ? { externalRef: t.externalRef } : {}) }, created: false };
    }
    return { slate, created: false };
  }
  const slate = await slateFns.createBoard(grant.ctx, {
    title: t.title ?? fallbackTitle,
    workspaceId: grant.workspaceId,
    thumbnailIcon: randomThumbnail(),
    createdVia: "connector",
    metadata: t.metadata,
    externalRef: t.externalRef,
  });
  return { slate, created: true };
}

export async function freshBoard(id: string) {
  const c = await getCollections();
  const slate = await c.slates.findOne({ _id: id }, { projection: { documentText: 0, documentJson: 0, elements: 0 } });
  if (!slate) throw err.notFound("Board");
  return boardWire(slate);
}

/** Writes Markdown to the document pane through the app's own `updateDocument` (access check, size cap, activity time). */
export async function writeMarkdown(grant: AuthedGrant, boardId: string, markdown: string, mode: "replace" | "append"): Promise<{ bytes: number }> {
  const { slate } = await loadGrantBoard(grant, boardId, { need: "edit", withDocument: true });
  const fields = mode === "append" ? appendMarkdown(slate, markdown) : documentFromMarkdown(markdown);
  await invoke(slateFns.updateDocument, grant.ctx, { id: boardId, ...fields });
  return { bytes: Buffer.byteLength(fields.documentText) };
}

export const summarise = (w: { kind: string; nodes: number; edges: number; groups: number }) => ({ kind: w.kind, nodes: w.nodes, edges: w.edges, groups: w.groups });

/* ------------------------------------------------------------------ actions */

export const createBoardAction = defineSyncAction({
  name: "boards.create",
  title: "Create a board",
  description: "Creates a board in the connected workspace, optionally starting from a built-in template. The workspace owner's plan limit on boards applies.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({
    title: titleSchema,
    template: z.string().max(80).optional().meta({ title: "Template", description: "A built-in template id from GET /templates; the board starts with that diagram.", examples: ["aws-microservices"] }),
    thumbnailIcon: z.enum(["1", "2", "3", "4", "5"]).optional().meta({ title: "Thumbnail", description: "Which of the five dashboard illustrations to use. Random if omitted." }),
    metadata: metadataSchema.optional(),
    externalRef: externalRefSchema.optional(),
  }),
  output: boardOutput,
  handler: async ({ grant }, input) => {
    const template = input.template ? templateById(input.template) : undefined;
    if (input.template && !template) throw err.validation(`Unknown template "${input.template}"`, [{ path: "template", message: "Not a built-in template id (see GET /templates)" }]);
    const slate = await slateFns.createBoard(grant.ctx, {
      title: input.title,
      workspaceId: grant.workspaceId,
      thumbnailIcon: input.thumbnailIcon ?? randomThumbnail(),
      createdVia: "connector",
      metadata: input.metadata,
      externalRef: input.externalRef,
    });
    if (template?.dsl) await writeDiagram(grant, slate, parseDsl(template.dsl).graph, { mode: "replace" });
    return { board: await freshBoard(slate._id) };
  },
});

export const importDslAction = defineSyncAction({
  name: "boards.importDsl",
  title: "Import diagram-as-code",
  description: "Parses Slate's diagram-as-code text, lays it out and puts it on a board (a new one if no boardId is given). No AI credits are used. Syntax errors come back with their line numbers.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({
    boardId: boardIdSchema.optional(),
    title: titleSchema.optional().describe("Title for the new board when boardId is omitted. Defaults to the title line of the DSL."),
    dsl: z.string().min(1).max(50_000).meta({ title: "Diagram as code", description: "Slate diagram-as-code (see boards.dsl for an example)." }),
    mode: modeSchema,
    metadata: metadataSchema.optional(),
    externalRef: externalRefSchema.optional(),
  }),
  output: z.object({ board: boardSchema, diagram: diagramOutput, dsl: z.string(), warnings: z.array(z.string()) }),
  handler: async ({ grant }, input) => {
    const { graph, errors } = parseDsl(input.dsl);
    if (errors.length > 0) {
      throw err.validation(`The diagram code has ${errors.length} problem${errors.length === 1 ? "" : "s"}`, errors.slice(0, 50).map((e) => ({ path: `dsl:${e.line}`, message: `Line ${e.line}: ${e.message}` })), 422);
    }
    if (graph.nodes.length === 0) throw err.validation("The diagram code defines no components", [{ path: "dsl", message: "Nothing to draw" }], 422);
    const { slate } = await targetBoard(grant, input, graph.title || "Imported diagram");
    const written = await writeDiagram(grant, slate, graph, { mode: input.mode });
    return { board: await freshBoard(slate._id), diagram: summarise(written), dsl: written.dsl, warnings: [] };
  },
});

type CodeFormat = "docker-compose" | "sql" | "tree";
const FORMAT_LABEL: Record<CodeFormat, string> = { "docker-compose": "a docker-compose file", sql: "SQL (CREATE TABLE statements)", tree: "a folder tree" };

function convertCode(content: string, format: "auto" | CodeFormat): ImportResult {
  if (format === "auto") {
    const found = convertSource(content);
    if (found) return found;
    throw err.validation("Could not tell what this is. Slate understands docker-compose files, SQL schemas and folder trees.", [{ path: "content", message: "Unrecognised format; set `format` explicitly if you are sure" }], 422);
  }
  const result = format === "docker-compose" ? composeToImport(content) : format === "sql" ? sqlToImport(content) : treeToImport(content);
  if (!result) throw err.validation(`That does not look like ${FORMAT_LABEL[format]}`, [{ path: "content", message: `Not ${FORMAT_LABEL[format]}` }], 422);
  return result;
}

export const importCodeAction = defineSyncAction({
  name: "boards.importCode",
  title: "Import code as a diagram",
  description: "Turns a docker-compose file, a SQL schema or a folder tree into a diagram plus generated documentation, using Slate's exact parsers (no AI, no credits). The documentation is written to the board's document pane.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({
    boardId: boardIdSchema.optional(),
    title: titleSchema.optional().describe("Title for the new board when boardId is omitted."),
    content: z.string().min(1).max(MAX_SOURCE_CHARS).meta({ title: "Source", description: "The text to import." }),
    format: z.enum(["auto", "docker-compose", "sql", "tree"]).default("auto").meta({ title: "Format", description: "auto detects the format from the text." }),
    mode: modeSchema,
    document: documentModeSchema.or(z.literal("none")).default("append").meta({ title: "Documentation", description: "Write the generated documentation to the document pane (replace / append) or skip it (none)." }),
    metadata: metadataSchema.optional(),
    externalRef: externalRefSchema.optional(),
  }),
  output: z.object({ board: boardSchema, diagram: diagramOutput, detected: z.enum(["compose", "sql", "tree", "ai"]), documentWritten: z.boolean(), warnings: z.array(z.string()) }),
  handler: async ({ grant }, input) => {
    const result = convertCode(input.content, input.format);
    const { slate } = await targetBoard(grant, input, result.title);
    const written = await writeDiagram(grant, slate, result.graph, { mode: input.mode });
    if (input.document !== "none") await writeMarkdown(grant, slate._id, result.markdown, input.document);
    return { board: await freshBoard(slate._id), diagram: summarise(written), detected: result.source, documentWritten: input.document !== "none", warnings: result.warnings };
  },
});

export const setDocumentAction = defineSyncAction({
  name: "boards.setDocument",
  title: "Write the document",
  description: "Writes Markdown into the document pane next to the diagram (the place for a full meeting summary or design notes). Open editors do not reload by themselves: whoever saves last wins.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({
    boardId: boardIdSchema,
    markdown: z.string().max(500_000).meta({ title: "Markdown", description: "Headings, lists, tables, code blocks, links and images are supported." }),
    mode: z.enum(["replace", "append"]).default("replace").meta({ title: "Mode", description: "replace the whole document, or append after what is there." }),
  }),
  output: z.object({ board: boardSchema, document: z.object({ bytes: z.number(), mode: z.enum(["replace", "append"]) }) }),
  handler: async ({ grant }, input) => {
    const { bytes } = await writeMarkdown(grant, input.boardId, input.markdown, input.mode);
    return { board: await freshBoard(input.boardId), document: { bytes, mode: input.mode } };
  },
});

export const setStatusAction = defineSyncAction({
  name: "boards.setStatus",
  title: "Set the review status",
  description: "Moves a board between draft, in review and approved. Only Admins and Editors can; approving is the signal that a design is ready to build, and sends board.status_changed and board.approved.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({
    boardId: boardIdSchema,
    status: boardStatusSchema,
    note: z.string().trim().max(500).optional().meta({ title: "Note", description: "Why, for the record. Shown to the team and included in the events." }),
  }),
  output: z.object({ board: boardSchema, previousStatus: boardStatusSchema, changed: z.boolean() }),
  handler: async ({ grant }, input) => {
    await loadGrantBoard(grant, input.boardId, { need: "edit" });
    const r = await slateFns.applyBoardStatus(grant.ctx, input.boardId, input.status, { note: input.note, via: "connector" });
    return { board: await freshBoard(input.boardId), previousStatus: r.from, changed: r.changed };
  },
});

export const setSharingAction = defineSyncAction({
  name: "boards.setSharing",
  title: "Change link sharing",
  description: "Sets who can open the board with just its link: nobody, anyone to view, or anyone signed in to edit. Returns the link when sharing is on.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({ boardId: boardIdSchema, linkAccess: linkAccessSchema }),
  output: z.object({ board: boardSchema, publicUrl: z.string().nullable() }),
  handler: async ({ grant }, input) => {
    await loadGrantBoard(grant, input.boardId, { need: "edit" });
    await slateFns.applyLinkAccess(grant.ctx, input.boardId, input.linkAccess, "connector");
    const board = await freshBoard(input.boardId);
    return { board, publicUrl: input.linkAccess === "none" ? null : board.webUrl };
  },
});

export const archiveAction = defineSyncAction({
  name: "boards.archive",
  title: "Archive a board",
  description: "Archives a board: it disappears from the workspace's boards. Nothing is deleted and it can be restored by an administrator; the connector cannot hard-delete.",
  scopes: ["slate:boards:write"],
  input: z.strictObject({ boardId: boardIdSchema }),
  output: z.object({ board: boardSchema, archived: z.literal(true) }),
  handler: async ({ grant }, input) => {
    const { slate } = await loadGrantBoard(grant, input.boardId, { need: "edit" });
    const board = await boardWire(slate);
    await slateFns.archiveBoard(grant.ctx, input.boardId, "connector");
    return { board, archived: true as const };
  },
});

/* ------------------------------------------------------------------ export */

const MAX_EXPORT_BYTES = 1_048_576;

function markdownExport(title: string, docMarkdown: string, graph: Graph): string {
  const parts: string[] = [];
  parts.push(docMarkdown.trim() ? docMarkdown.trim() : `# ${title}`);
  if (graph.nodes.length > 0) {
    parts.push("---", "## Diagram");
    const mermaid = graphToMermaid(graph);
    if (mermaid) parts.push("```mermaid\n" + mermaid + "\n```");
    parts.push("### Diagram as code", "```slate-dsl\n" + graphToDsl(graph) + "\n```");
  }
  return parts.join("\n\n") + "\n";
}

export const exportAction = defineSyncAction({
  name: "boards.export",
  title: "Export a board",
  description: "Returns the board inline as diagram-as-code, Slate board JSON, SVG, or Markdown (the document pane followed by the diagram as Mermaid and as code). Up to 1 MB.",
  scopes: ["slate:boards:read"],
  input: z.strictObject({
    boardId: boardIdSchema,
    format: z.enum(["dsl", "json", "svg", "markdown"]).meta({ title: "Format", description: "dsl: diagram-as-code. json: Slate board file. svg: picture. markdown: document + diagram." }),
  }),
  output: z.object({ format: z.enum(["dsl", "json", "svg", "markdown"]), content: z.string(), bytes: z.number() }),
  handler: async ({ grant }, input) => {
    const { slate } = await loadGrantBoard(grant, input.boardId, { withDocument: input.format === "markdown" });
    const els = await loadBoardElements(slate._id);
    let content: string;
    if (input.format === "json") {
      content = JSON.stringify({ kind: "slate-board", version: 2, elements: els }, null, 2);
    } else if (input.format === "svg") {
      const engine = new Engine();
      engine.store.load(els);
      const svg = exportSvg(engine, { scale: 1, padding: 40, transparent: false, selectionOnly: false, branding: false, theme: "light" });
      if (!svg) throw err.precondition("The board is empty, so there is nothing to draw");
      content = svg;
    } else {
      const graph = graphFromElements(els);
      content = input.format === "dsl" ? (graph.nodes.length ? graphToDsl(graph) : "") : markdownExport(slate.title, slate.documentText ?? "", graph);
    }
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_EXPORT_BYTES) throw err.validation(`The export is ${bytes} bytes; the limit is ${MAX_EXPORT_BYTES}`, [{ path: "format", message: "Too large to return inline" }], 413);
    return { format: input.format, content, bytes };
  },
});

export const BOARD_ACTIONS = [createBoardAction, importDslAction, importCodeAction, setDocumentAction, setStatusAction, setSharingAction, exportAction, archiveAction] as const;
