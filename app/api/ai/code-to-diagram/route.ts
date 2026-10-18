import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { generateGraph } from "@/lib/ai/generate";
import { AiError, nvidiaConfig } from "@/lib/ai/nvidia";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { refundAiCredit, reserveAiCredit } from "@/lib/billing/ai-credits";
import { graphToDsl } from "@/lib/diagram/dsl";
import { aiImport, convertSource, MAX_SOURCE_CHARS } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  source: z.string().trim().min(8, "Paste a docker-compose file, a SQL schema, a directory tree or some code").max(MAX_SOURCE_CHARS, "That's too long. Paste the relevant part (up to 60,000 characters)."),
  /** "ai" skips the built-in parsers and always asks the model. */
  mode: z.enum(["auto", "ai"]).default("auto"),
});

/** The model only needs enough of the source to see the components and how they connect. */
const MODEL_SOURCE_CHARS = 14_000;

function json(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * POST /api/ai/code-to-diagram
 * Turns pasted source into a diagram *and* the documentation that belongs next to it.
 *   docker-compose.yml, SQL DDL, directory trees  -> parsed exactly, instantly, free of AI credits
 *   anything else (code, Kubernetes, Terraform...) -> drawn by the model, costing one AI credit
 * Layout happens in the browser, as for every other diagram.
 */
export async function POST(req: Request) {
  const { userId, getToken } = await auth();
  if (!userId) return json(401, "unauthenticated", "Sign in to import code.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_SOURCE_CHARS * 4 + 2000) return json(413, "too_large", "That request is too large.");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return json(400, "bad_request", e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid request" : "Invalid request body");
  }

  if (body.mode === "auto") {
    const exact = convertSource(body.source);
    if (exact) {
      return Response.json(
        { source: exact.source, title: exact.title, graph: exact.graph, dsl: graphToDsl(exact.graph), markdown: exact.markdown, warnings: exact.warnings },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  const cfg = nvidiaConfig();
  if (!cfg.apiKey) {
    return json(503, "not_configured", "Slate understands docker-compose files, SQL schemas and directory trees without AI. For other code, add NVIDIA_API_KEY (free at build.nvidia.com) to enable AI import.");
  }

  let token: string | null = null;
  try {
    token = await getToken({ template: "convex" });
  } catch {
    token = null;
  }
  const limit = await checkAiRateLimit(userId, token);
  if (!limit.allowed) {
    const secs = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return json(429, "rate_limited", limit.scope === "burst" ? "You're importing too quickly. Give it a few seconds." : "You've reached the hourly AI limit. Try again later.", { retryAfterSeconds: secs }, { "Retry-After": String(secs) });
  }

  const credit = await reserveAiCredit(token);
  if (!credit.ok) {
    if (credit.reason === "exhausted") return json(402, credit.error.code, credit.error.message, { tier: credit.error.tier, limit: credit.error.limit, resetsAt: credit.resetsAt });
    return json(503, "billing_unavailable", credit.message);
  }

  try {
    const excerpt = body.source.length > MODEL_SOURCE_CHARS ? `${body.source.slice(0, MODEL_SOURCE_CHARS)}\n… (truncated)` : body.source;
    const result = await generateGraph(
      {
        prompt: `Draw the architecture of the system described by the source below. Identify the real components it defines or uses (services, databases, caches, queues, external providers, jobs) and how they connect. Name components the way the source does.\n\nSOURCE\n${excerpt}`,
        kind: "auto",
        complexity: "standard",
      },
      cfg,
      {},
      req.signal
    );
    const warnings = [...result.warnings, ...(body.source.length > MODEL_SOURCE_CHARS ? ["Only the first part of the source was sent to the model."] : [])];
    const imported = aiImport(result.graph, warnings);
    return Response.json(
      { source: "ai", title: imported.title, graph: imported.graph, dsl: result.dsl, markdown: imported.markdown, warnings, model: result.model, credits: { used: credit.used, cap: credit.cap, remaining: credit.remaining } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    await refundAiCredit(userId);
    const err = e instanceof AiError ? e : new AiError("upstream", "Unexpected error while reading the source");
    if (!(e instanceof AiError)) console.error("[ai/code-to-diagram]", e);
    const status = err.code === "rate_limited" ? 429 : err.code === "bad_key" || err.code === "not_configured" ? 503 : err.code === "aborted" ? 499 : 502;
    return json(status, err.code, err.message, err.retryAfterMs ? { retryAfterSeconds: Math.ceil(err.retryAfterMs / 1000) } : {});
  }
}
