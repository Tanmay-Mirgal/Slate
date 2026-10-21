import { readImage } from "@/lib/server/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/files/<id>
 * Serves an uploaded board image. The id is unguessable, so (like the storage URLs this replaced) the
 * link itself is the permission; files never change, so browsers may cache them for good. The extra
 * headers keep an uploaded SVG from ever running script, even if someone opens it directly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await readImage(id);
  if (!file) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(file.stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
