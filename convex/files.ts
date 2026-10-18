import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireEdit } from "./access";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Step 1 of an image upload: a short-lived URL the browser POSTs the file to. */
export const generateUploadUrl = mutation({
  args: { slateId: v.id("slates") },
  handler: async (ctx, args) => {
    await requireEdit(ctx, args.slateId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2: validate what was uploaded and return the permanent URL stored on the image element.
 *
 * Rejections are returned, not thrown: a throwing mutation rolls back its transaction, which would
 * undo the `storage.delete` of the offending file and leave it in storage.
 */
export const finalizeImage = mutation({
  args: { slateId: v.id("slates"), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
    await requireEdit(ctx, args.slateId);
    const meta = await ctx.db.system.get("_storage", args.storageId);
    if (!meta) return { ok: false, error: "Upload not found" };
    const okType = !!meta.contentType && /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)$/.test(meta.contentType);
    if (!okType || meta.size > MAX_IMAGE_BYTES) {
      await ctx.storage.delete(args.storageId);
      return { ok: false, error: okType ? "Image is too large (max 12 MB)" : "Only image files can be uploaded" };
    }
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) return { ok: false, error: "Could not create a URL for the image" };
    return { ok: true, url };
  },
});
