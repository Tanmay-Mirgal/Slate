import { Readable } from "node:stream";
import type { ObjectId } from "mongodb";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { getCollections, newSecretId } from "@/lib/db/mongo";
import type { Id } from "@/lib/db/types";
import { requireEdit } from "./access";
import type { Ctx } from "./fn";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)$/;

/** Does the content start the way the claimed image type says it should? The Content-Type header alone is just a claim. */
export function looksLikeImage(type: string, bytes: Uint8Array): boolean {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  switch (type) {
    case "image/png":
      return head(4).join(",") === "137,80,78,71";
    case "image/jpeg":
    case "image/jpg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return ascii(0, 4) === "GIF8";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/avif":
      return ascii(4, 8) === "ftyp" && /avi[fs]/.test(ascii(8, 12));
    case "image/svg+xml": {
      const text = new TextDecoder().decode(bytes.subarray(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
      return text.startsWith("<svg") || text.startsWith("<?xml") || text.startsWith("<!--") || text.startsWith("<!doctype svg");
    }
    default:
      return false;
  }
}

export type StoreResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Stores an uploaded image in GridFS and returns the permanent URL stored on the image element.
 * Rejections are returned, not thrown, so the caller can show them to the person who uploaded.
 */
export async function storeImage(ctx: Ctx, slateId: Id<"slates">, contentType: string, bytes: Uint8Array): Promise<StoreResult> {
  await requireEdit(ctx, slateId);
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPE.test(type) || !looksLikeImage(type, bytes)) return { ok: false, error: "Only image files can be uploaded" };
  if (bytes.byteLength === 0) return { ok: false, error: "That file is empty" };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 12 MB)" };

  const c = await getCollections();
  const id = newSecretId();
  await new Promise<void>((resolve, reject) => {
    const up = c.files.openUploadStreamWithId(id as unknown as ObjectId, "image", { metadata: { slateId, contentType: type, uploadedBy: ctx.userId } });
    up.on("error", reject);
    up.on("finish", () => resolve());
    up.end(Buffer.from(bytes));
  });
  return { ok: true, url: `/api/files/${id}` };
}

export interface StoredFile {
  stream: WebReadableStream<Uint8Array>;
  contentType: string;
  length: number;
}

/** Streams a stored image. Files are addressed by an unguessable id, like the storage URLs they replace. */
export async function readImage(id: string): Promise<StoredFile | null> {
  if (!/^[0-9a-f]{20,64}$/.test(id)) return null;
  const c = await getCollections();
  const file = await c.files.find({ _id: id as never }).limit(1).next();
  if (!file) return null;
  const type = String((file.metadata as { contentType?: string } | undefined)?.contentType ?? "");
  if (!IMAGE_TYPE.test(type)) return null;
  const node = c.files.openDownloadStream(id as never);
  return { stream: Readable.toWeb(node) as unknown as WebReadableStream<Uint8Array>, contentType: type, length: file.length };
}
