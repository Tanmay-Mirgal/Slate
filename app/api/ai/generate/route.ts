import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { generateGraph } from "@/lib/ai/generate";
import { AiError, nvidiaConfig } from "@/lib/ai/nvidia";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { refundAiCredit, reserveAiCredit } from "@/lib/billing/ai-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds. Model calls are streamed, so the platform limit only needs to cover the slowest model. */
export const maxDuration = 120;

const Body = z.object({
  prompt: z.string().trim().min(3, "Describe what you want to diagram").max(2000, "Please keep the description under 2000 characters"),
  kind: z.enum(["auto", "architecture", "flowchart", "erd", "mindmap", "sequence"]).default("auto"),
  complexity: z.enum(["simple", "standard", "detailed"]).default("standard"),
  currentDsl: z.string().max(14000).optional(),
});

const headers = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

function json(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headersInit: Record<string, string> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "Cache-Control": "no-store", ...headersInit } });
}

/**
 * POST /api/ai/generate
 * Turns a prompt into a validated diagram *graph* using NVIDIA-hosted models and streams progress as
 * newline-delimited JSON. Layout is deliberately NOT done here: the browser lays the graph out, so
 * server cost per request is just the model call.
 */
export async function POST(req: Request) {
  const { userId, getToken } = await auth();
  if (!userId) return json(401, "unauthenticated", "Sign in to use Slate AI.");

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 40_000) return json(413, "too_large", "That request is too large.");

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid request" : "Invalid request body";
    return json(400, "bad_request", msg);
  }

  const cfg = nvidiaConfig();
  if (!cfg.apiKey) {
    return json(503, "not_configured", "AI generation isn't set up yet. Add NVIDIA_API_KEY (free at build.nvidia.com) to your environment.");
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
    return json(
      429,
      "rate_limited",
      limit.scope === "burst" ? "You're generating too quickly. Give it a few seconds." : "You've reached the hourly AI limit. Try again later.",
      { retryAfterSeconds: secs },
      { "Retry-After": String(secs) }
    );
  }

  // Credits are reserved up front and refunded if the model never produces a diagram.
  const credit = await reserveAiCredit(token);
  if (!credit.ok) {
    if (credit.reason === "exhausted") return json(402, credit.error.code, credit.error.message, { tier: credit.error.tier, limit: credit.error.limit, resetsAt: credit.resetsAt });
    return json(503, "billing_unavailable", credit.message);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        let lastProgress = 0;
        const result = await generateGraph(
          { prompt: parsed.prompt, kind: parsed.kind, complexity: parsed.complexity, currentDsl: parsed.currentDsl },
          cfg,
          {
            onStatus: (s) => send({ type: "status", ...s }),
            onProgress: (chars) => {
              const now = Date.now();
              if (now - lastProgress > 250) {
                lastProgress = now;
                send({ type: "progress", chars });
              }
            },
          },
          req.signal
        );
        send({ type: "result", graph: result.graph, dsl: result.dsl, warnings: result.warnings, model: result.model, attempts: result.attempts, credits: { used: credit.used, cap: credit.cap, remaining: credit.remaining } });
      } catch (e) {
        await refundAiCredit(userId);
        const err = e instanceof AiError ? e : new AiError("upstream", "Unexpected error while generating the diagram");
        if (!(e instanceof AiError)) console.error("[ai/generate]", e);
        send({ type: "error", code: err.code, message: err.message, retryAfterSeconds: err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : undefined });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers });
}
