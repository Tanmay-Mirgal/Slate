import { z } from "zod";
import { generateGraph } from "@/lib/ai/generate";
import { AiError, nvidiaConfig } from "@/lib/ai/nvidia";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { generateReview } from "@/lib/ai/review";
import { reserveAiCredit } from "@/lib/billing/ai-credits";
import { getCollections } from "@/lib/db/mongo";
import { graphToDsl } from "@/lib/diagram/dsl";
import { graphFromElements } from "@/lib/diagram/extract";
import { estimateCost } from "@/lib/finops/estimate";
import { heuristicReview } from "@/lib/interview/review";
import { findSpofs } from "@/lib/simulation/topology";
import { requireScopes } from "../auth/verify";
import { iso, loadBoardElements, loadGrantBoard } from "../data";
import { ConnectError, err } from "../errors";
import { actorOf, emitBoardEvent } from "../events/board-events";
import { defineAsyncAction, defineSyncAction } from "../registry/define";
import { externalRefSchema, metadataSchema } from "../registry/schema";
import { boardSchema } from "../resources/boards";
import { boardIdSchema, diagramOutput, documentModeSchema, freshBoard, modeSchema, summarise, targetBoard, titleSchema, writeMarkdown } from "./boards";
import { writeDiagram } from "./diagram";

/* ------------------------------------------------------------------ helpers */

const creditsSchema = z.object({ used: z.number(), cap: z.number(), remaining: z.number() }).meta({ title: "AI credits", description: "The connected user's AI credits after this call (credits are spent from their own balance)." });

/** What an AI failure looks like to a caller: never the provider's own message or key state. */
export function fromAiError(e: unknown): ConnectError {
  if (e instanceof ConnectError) return e;
  if (!(e instanceof AiError)) return err.upstream("The AI service failed");
  switch (e.code) {
    case "not_configured":
    case "bad_key":
      return err.unavailable("AI generation is not available right now");
    case "rate_limited":
      return err.rateLimited(Math.max(1, Math.ceil((e.retryAfterMs ?? 30_000) / 1000)));
    case "invalid_output":
      return err.upstream("The model did not produce a usable result. No credits were used; try again or simplify the prompt.");
    case "aborted":
      return err.unavailable("The request was cancelled");
    default:
      return err.upstream("The AI service did not answer in time");
  }
}

/** The checks that must pass before AI credits are taken, and the credit itself. Throws the CP1 error for each refusal. */
async function reserveForAi(userId: string): Promise<{ used: number; cap: number; remaining: number }> {
  if (!nvidiaConfig().apiKey) throw err.unavailable("AI generation is not set up on this Slate deployment");
  const limit = await checkAiRateLimit(userId);
  if (!limit.allowed) throw err.rateLimited(Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
  const credit = await reserveAiCredit(userId);
  if (!credit.ok) {
    if (credit.reason === "exhausted") throw err.planLimit(credit.error.message, { limit: credit.error.limit, tier: credit.error.tier, reason: credit.error.code, resetsAt: iso(credit.resetsAt) });
    throw err.unavailable(credit.message);
  }
  return { used: credit.used, cap: credit.cap, remaining: credit.remaining };
}

/* ------------------------------------------------------------------ boards.generateDiagram */

interface GenerateState extends Record<string, unknown> {
  boardId: string;
  createdBoard: boolean;
  credits: { used: number; cap: number; remaining: number };
}

export const generateDiagramAction = defineAsyncAction({
  name: "boards.generateDiagram",
  title: "Generate a diagram with AI",
  description:
    "Turns a prompt into a diagram on a board (a new one if no boardId is given): the same model pipeline as the app's AI panel, laid out on the server so nothing overlaps. Costs 1 AI credit from the connected user, handed back if it fails. Asynchronous: poll the operation. Optionally writes a long Markdown document next to the diagram, so the prompt can stay short.",
  scopes: ["slate:ai:generate", "slate:boards:write"],
  input: z.strictObject({
    boardId: boardIdSchema.optional(),
    title: titleSchema.optional().describe("Title for the new board when boardId is omitted."),
    prompt: z.string().trim().min(3).max(2000).meta({ title: "Prompt", description: "What to draw.", examples: ["A checkout service with a payment gateway, an order queue and a Postgres database"] }),
    kind: z.enum(["auto", "architecture", "flowchart", "erd", "mindmap", "sequence"]).default("auto").meta({ title: "Diagram kind" }),
    complexity: z.enum(["simple", "standard", "detailed"]).default("standard").meta({ title: "Complexity", description: "Roughly how many components to draw." }),
    mode: modeSchema,
    document: z.strictObject({ markdown: z.string().min(1).max(50_000), mode: documentModeSchema }).optional().meta({ title: "Document", description: "Markdown to write into the document pane (for example the full meeting summary)." }),
    metadata: metadataSchema.optional(),
    externalRef: externalRefSchema.optional(),
  }),
  output: z.object({ board: boardSchema, diagram: diagramOutput, dsl: z.string(), warnings: z.array(z.string()), model: z.string(), credits: creditsSchema }),

  // Everything that can be refused is refused here, while the caller is still on the line: access, plan limits, the AI rate limit, credits.
  accept: async ({ grant }, input): Promise<{ state: GenerateState; creditsReserved: number }> => {
    const { slate, created } = await targetBoard(grant, input, input.title ?? "AI diagram");
    try {
      const credits = await reserveForAi(grant.userId);
      return { state: { boardId: slate._id, createdBoard: created, credits }, creditsReserved: 1 };
    } catch (e) {
      // a board made just for this request is not left behind empty when the request is refused
      if (created) await (await import("@/lib/server/slates")).archiveBoard(grant.ctx, slate._id, "connector").catch(() => undefined);
      throw e;
    }
  },

  run: async ({ grant, operationId }, input, state) => {
    const { slate } = await loadGrantBoard(grant, state.boardId, { need: "edit" });
    const actor = await actorOf(grant.ctx, "connector");
    await emitBoardEvent("board.generation.started", slate, actor, () => ({ operationId }));

    let generated;
    try {
      generated = await generateGraph({ prompt: input.prompt, kind: input.kind, complexity: input.complexity }, nvidiaConfig());
    } catch (e) {
      throw fromAiError(e);
    }
    const written = await writeDiagram(grant, slate, generated.graph, { mode: input.mode });
    if (input.document) await writeMarkdown(grant, slate._id, input.document.markdown, input.document.mode);

    const diagram = summarise(written);
    await emitBoardEvent("board.generation.completed", slate, actor, () => ({ operationId, diagram }));
    return { board: await freshBoard(slate._id), diagram, dsl: written.dsl, warnings: generated.warnings, model: generated.model, credits: state.credits };
  },

  onFailure: async ({ grant, operationId }, _input, state, error) => {
    const c = await getCollections();
    const slate = await c.slates.findOne({ _id: state.boardId }, { projection: { documentText: 0, documentJson: 0, elements: 0 } });
    if (!slate) return;
    await emitBoardEvent("board.generation.failed", slate, await actorOf(grant.ctx, "connector"), () => ({ operationId, error: { code: error.code, message: error.message } }));
  },
});

/* ------------------------------------------------------------------ boards.review */

const reviewSchema = z.object({
  source: z.enum(["heuristic", "ai"]),
  score: z.number().describe("0 to 100"),
  summary: z.string(),
  categories: z.array(z.object({ id: z.string(), name: z.string(), score: z.number().describe("0 to 10"), feedback: z.string(), suggestions: z.array(z.string()) })),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  model: z.string().optional(),
  createdAt: z.string(),
});

export const reviewAction = defineSyncAction({
  name: "boards.review",
  title: "Review the architecture",
  description:
    "Grades the board's architecture against the system design rubric. mode \"structural\" is instant and free (rules over the diagram). mode \"ai\" is a written review by the model, costs 1 AI credit from the connected user and needs the slate:ai:generate scope; it can take up to a minute.",
  scopes: ["slate:boards:read"],
  input: z.strictObject({ boardId: boardIdSchema, mode: z.enum(["structural", "ai"]).default("structural") }),
  output: z.object({ mode: z.enum(["structural", "ai"]), review: reviewSchema, credits: creditsSchema.optional() }),
  handler: async ({ grant }, input) => {
    const { slate } = await loadGrantBoard(grant, input.boardId);
    const els = await loadBoardElements(slate._id);
    if (els.length === 0) throw err.precondition("The board is empty, so there is nothing to review");

    if (input.mode === "structural") {
      const r = heuristicReview(els, []);
      return { mode: "structural" as const, review: { ...r, createdAt: iso(r.createdAt) } };
    }

    requireScopes(grant, ["slate:ai:generate"]);
    const graph = graphFromElements(els);
    const credits = await reserveForAi(grant.userId);
    try {
      const { review, model } = await generateReview({ dsl: graph.nodes.length ? graphToDsl(graph) : "", checklist: [], notes: (await loadGrantBoard(grant, input.boardId, { withDocument: true })).slate.documentText?.slice(0, 6000) }, nvidiaConfig());
      return { mode: "ai" as const, review: { ...review, model, createdAt: iso(review.createdAt) }, credits };
    } catch (e) {
      const { refundAiCredit } = await import("@/lib/billing/ai-credits");
      await refundAiCredit(grant.userId);
      throw fromAiError(e);
    }
  },
});

/* ------------------------------------------------------------------ boards.estimateCost / boards.analyzeResilience */

export const estimateCostAction = defineSyncAction({
  name: "boards.estimateCost",
  title: "Estimate the cloud cost",
  description: "A monthly cloud cost estimate for the components on the board, itemised by component, with the assumption behind each figure and savings tips. Components with no price rule are not counted. The itemised list is returned on every plan.",
  scopes: ["slate:boards:read"],
  input: z.strictObject({ boardId: boardIdSchema }),
  output: z.object({
    monthlyUsd: z.number(),
    byComponent: z.array(z.object({ nodeId: z.string(), label: z.string(), service: z.string(), provider: z.string(), quantity: z.number(), assumption: z.string(), monthlyUsd: z.number() })),
    byProvider: z.record(z.string(), z.number()),
    unpriced: z.number().describe("Cloud-service components that look like infrastructure but have no price rule"),
    tips: z.array(z.object({ id: z.string(), message: z.string(), savingsUsd: z.number().optional() })),
  }),
  handler: async ({ grant }, input) => {
    const { slate } = await loadGrantBoard(grant, input.boardId);
    const estimate = estimateCost(await loadBoardElements(slate._id));
    return {
      monthlyUsd: estimate.total,
      byComponent: estimate.items.map((i) => ({ nodeId: i.nodeId, label: i.label, service: i.rule.service, provider: i.rule.provider, quantity: i.quantity, assumption: i.rule.assumption, monthlyUsd: i.monthly })),
      byProvider: Object.fromEntries(Object.entries(estimate.byProvider).filter((e): e is [string, number] => typeof e[1] === "number")),
      unpriced: estimate.unpriced,
      tips: estimate.tips.map((t) => ({ id: t.id, message: t.message, ...(t.savings !== undefined ? { savingsUsd: t.savings } : {}) })),
    };
  },
});

export const analyzeResilienceAction = defineSyncAction({
  name: "boards.analyzeResilience",
  title: "Find single points of failure",
  description: "Components many others depend on and that have no redundancy, most severe first.",
  scopes: ["slate:boards:read"],
  input: z.strictObject({ boardId: boardIdSchema }),
  output: z.object({
    singlePointsOfFailure: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string(), dependents: z.number(), replicas: z.number(), severity: z.enum(["high", "medium"]), message: z.string() })),
    summary: z.object({ high: z.number(), medium: z.number(), total: z.number() }),
  }),
  handler: async ({ grant }, input) => {
    const { slate } = await loadGrantBoard(grant, input.boardId);
    const spofs = findSpofs(await loadBoardElements(slate._id));
    return {
      singlePointsOfFailure: spofs,
      summary: { high: spofs.filter((s) => s.severity === "high").length, medium: spofs.filter((s) => s.severity === "medium").length, total: spofs.length },
    };
  },
});

export const AI_ACTIONS = [generateDiagramAction, reviewAction, estimateCostAction, analyzeResilienceAction] as const;
