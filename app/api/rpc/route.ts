import { requestContext } from "@/lib/server/context";
import { AppError, invoke } from "@/lib/server/fn";
import { lookup } from "@/lib/server/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The biggest request body accepted (a batch of canvas operations is the largest thing sent). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const noStore = { "Cache-Control": "no-store" };

/**
 * POST /api/rpc  { fn: "slates.list", args: { ... } }
 * The single entry point for every browser -> database call. The caller is identified from the Clerk
 * session cookie (anonymous visitors are allowed: each function decides what they may see), arguments
 * are validated by the function's schema, and only functions declared with `query()` / `mutation()`
 * can be reached.
 *
 *   200 { ok: true, data }
 *   4xx/5xx { ok: false, error: { message, data? } }
 */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: { message: "That request is too large." } }, { status: 413, headers: noStore });
  }

  let body: { fn?: unknown; args?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: { message: "Invalid request body" } }, { status: 400, headers: noStore });
  }

  const fn = typeof body.fn === "string" ? lookup(body.fn) : undefined;
  if (!fn) return Response.json({ ok: false, error: { message: "Unknown function" } }, { status: 404, headers: noStore });

  try {
    const ctx = await requestContext();
    const data = await invoke(fn, ctx, body.args);
    return Response.json({ ok: true, data }, { headers: noStore });
  } catch (e) {
    if (e instanceof AppError) {
      return Response.json({ ok: false, error: { message: e.message, data: e.data } }, { status: 400, headers: noStore });
    }
    console.error(`[rpc] ${String(body.fn)} failed:`, e);
    return Response.json({ ok: false, error: { message: "Something went wrong. Please try again." } }, { status: 500, headers: noStore });
  }
}
