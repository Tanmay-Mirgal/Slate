import { requestContext } from "@/lib/server/context";
import { AppError } from "@/lib/server/fn";
import { MAX_IMAGE_BYTES, storeImage } from "@/lib/server/files";
import { takeToken } from "@/lib/server/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers: noStore });

/**
 * POST /api/files?slateId=<id>   (body: the raw image bytes, Content-Type: the image's type)
 * Stores an image for a board the caller can edit and answers { ok: true, url }. The URL is what the
 * image element keeps; `GET /api/files/<id>` serves it.
 */
export async function POST(req: Request) {
  const slateId = new URL(req.url).searchParams.get("slateId");
  if (!slateId || slateId.length > 120) return fail(400, "Missing board");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return fail(413, "Image is too large (max 12 MB)");

  try {
    const ctx = await requestContext();
    if (!ctx.userId) return fail(401, "Sign in to upload images");
    const limit = await takeToken(ctx.userId, "upload", 60, 60_000);
    if (!limit.allowed) return fail(429, "You're uploading too quickly. Try again in a moment.");

    const bytes = new Uint8Array(await req.arrayBuffer());
    const result = await storeImage(ctx, slateId, req.headers.get("content-type") ?? "", bytes);
    return Response.json(result, { status: result.ok ? 200 : 400, headers: noStore });
  } catch (e) {
    if (e instanceof AppError) return fail(403, e.message);
    console.error("[files] upload failed:", e);
    return fail(500, "Could not store the image");
  }
}
